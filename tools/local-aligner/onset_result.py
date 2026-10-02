from __future__ import annotations

import math
import unicodedata
from typing import Any


def _integer(value: Any) -> bool:
    return type(value) is int


def _raw(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return {"non_finite": "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")}
    return value


def _lexical(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return "".join(ch for ch in normalized if not ch.isspace() and not unicodedata.category(ch).startswith("P"))


def _spoken_character(value: str) -> bool:
    return len(value) == 1 and not value.isspace() and not unicodedata.category(value).startswith("P")


def map_character_onsets(items, *, transcript, sentence_id, crop_start_sample, crop_frames,
                         sample_rate, clip_frames, source):
    """Map native aligner units to conservative clip-relative onset candidates."""
    if type(items) is not list or len(items) > 6000:
        raise ValueError("Invalid alignment units.")
    if type(transcript) is not str or not transcript.strip() or len(transcript) > 6000:
        raise ValueError("Invalid transcript.")
    transcript_key = _lexical(transcript)
    if not transcript_key:
        raise ValueError("Invalid transcript.")
    for value in (sentence_id, source):
        if type(value) is not str or not value.strip() or len(value) > 128:
            raise ValueError("Invalid result metadata.")
    if not all(_integer(v) for v in (crop_start_sample, crop_frames, sample_rate, clip_frames)):
        raise ValueError("Invalid sample metadata.")
    if sample_rate <= 0 or sample_rate > 192000 or crop_start_sample < 0 or crop_frames <= 0 or clip_frames <= 0:
        raise ValueError("Invalid sample metadata.")
    if crop_start_sample + crop_frames > clip_frames or clip_frames > sample_rate * 120:
        raise ValueError("Invalid sample metadata.")
    raw = []
    for item in items:
        if type(item) is not dict or set(item) != {"text", "start_time", "end_time"}:
            raise ValueError("Invalid alignment unit shape.")
        text, start, end = item["text"], item["start_time"], item["end_time"]
        if text is not None and type(text) is not str:
            raise ValueError("Invalid alignment unit value.")
        if any(v is not None and type(v) not in (str, int, float, bool) for v in (start, end)):
            raise ValueError("Invalid alignment unit value.")
        raw.append({"text": _raw(text), "start_time": _raw(start), "end_time": _raw(end)})

    crop_seconds = crop_frames / sample_rate
    crop_ms = crop_start_sample / sample_rate * 1000
    sentence_end_ms = round((crop_start_sample + crop_frames) / sample_rate * 1000)
    units = []
    valid_starts = {}
    lexical_parts = []
    for index, item in enumerate(items):
        text, start = item["text"], item["start_time"]
        if type(text) is str:
            lexical_parts.append(text)
        normalized = unicodedata.normalize("NFC", text) if type(text) is str else ""
        lexical = _lexical(normalized) if type(text) is str else ""
        char_unit = type(text) is str and _spoken_character(normalized)
        word_unit = type(text) is str and bool(lexical) and not char_unit
        granularity = "character" if char_unit else ("word" if word_unit else "unsupported")
        onset = None
        start_valid = (type(start) in (int, float) and math.isfinite(start) and
                       0 <= start < crop_seconds)
        if start_valid:
            onset = round(crop_ms + float(start) * 1000)
            valid_starts[index] = float(start)
        if not start_valid:
            reason = "invalid_start_time"
        elif granularity == "unsupported":
            reason = "unsupported_text"
        elif granularity == "word":
            reason = "native_unit_not_character"
        elif onset >= sentence_end_ms:
            reason = "rounded_outside_sentence"
        else:
            reason = None
        status = "unavailable" if reason else "candidate"
        units.append({"index": index, "text": text, "granularity": granularity,
                      "onset_ms": onset, "status": status, "reason": reason})

    ordered = sorted(valid_starts)
    implicated = set()
    prior = None
    for index in ordered:
        if prior is not None and valid_starts[index] < valid_starts[prior]:
            implicated.update((prior, index))
        prior = index
    for index in implicated:
        units[index]["status"] = "unavailable"
        units[index]["reason"] = "non_monotonic_onset"
    same_ms = {}
    for index in ordered:
        same_ms.setdefault(units[index]["onset_ms"], []).append(index)
    for indices in same_ms.values():
        if len(indices) > 1:
            for index in indices:
                if units[index]["granularity"] == "character" and units[index]["status"] == "candidate":
                    units[index]["status"] = "ambiguous"
                    units[index]["reason"] = "indistinguishable_onset"

    lexical_complete = bool(_lexical("".join(lexical_parts))) and _lexical("".join(lexical_parts)) == transcript_key
    if not lexical_complete:
        status = "invalid"
        coverage = "mismatch"
    else:
        coverage = "complete"
        status = "candidate" if all(u["granularity"] == "character" and u["status"] == "candidate" for u in units) else "partial"
    return {
        "schema_version": "onset-0.1", "sentence_id": sentence_id, "transcript": transcript,
        "source": source, "timing_kind": "character_onsets",
        "sentence_start_ms": round(crop_start_sample / sample_rate * 1000),
        "sentence_end_ms": sentence_end_ms, "duration_ms": round(clip_frames / sample_rate * 1000),
        "sentence_bounds_source": "caller_crop_samples", "lexical_coverage": coverage,
        "status": status, "units": units, "raw_units": raw,
    }
