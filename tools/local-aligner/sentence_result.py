from __future__ import annotations

import math
import unicodedata
from typing import Any


def _lexical_key(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return "".join(character for character in normalized if not character.isspace() and not unicodedata.category(character).startswith("P"))


def _split_spans(transcript: str) -> list[tuple[str, int, int]]:
    # Lexical validation is performed by the caller before splitting.
    length = len(transcript)
    terminal = "\u3002\uff01\uff1f!?\r\n"
    closers = "\"'\u201d\u2019\u300d\u300f\u3011\u300b\u3009\u3014\uff3d\uff5d"
    spans: list[tuple[str, int, int]] = []
    lexical_positions = [i for i, char in enumerate(transcript) if _lexical_key(char)]
    if not lexical_positions:
        return spans
    first_lex = lexical_positions[0]
    last_lex = lexical_positions[-1]
    start = 0
    index = first_lex
    while index <= last_lex:
        if transcript[index] in terminal:
            end = index + 1
            while end <= last_lex and transcript[end] in terminal:
                end += 1
            while end <= last_lex and transcript[end] in closers:
                end += 1
            # A terminal creates a boundary only when another lexical character follows.
            next_lex = next((p for p in lexical_positions if p >= end), None)
            if next_lex is not None:
                spans.append((transcript[start:end], start, end))
                start = end
                index = max(end, next_lex)
                continue
        index += 1
    spans.append((transcript[start:], start, length))
    return spans


def _time_value(value: Any) -> tuple[float | None, bool]:
    if value is None:
        return None, True
    if isinstance(value, dict) and set(value) == {"non_finite"} and value["non_finite"] in {"NaN", "Infinity", "-Infinity"}:
        return None, True
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("native time has invalid shape")
    numeric = float(value)
    if not math.isfinite(numeric):
        return None, True
    return numeric, False


def _copy_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _copy_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy_json(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return {"non_finite": "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")}
    return value


def map_sentence_bounds(items: list[dict[str, Any]], *, transcript: str, sample_rate: int, clip_frames: int, source: str, sentence_texts: list[str] | None = None, segmentation_source: str | None = None) -> dict[str, Any]:
    """Map native timing to local sentence candidates.

    External sentence texts only propose lexical boundaries; local native units
    determine time. Semantic proposals alone never provide timestamps.
    """
    if not isinstance(items, list) or len(items) > 6000:
        raise ValueError("items must be a list of at most 6000 units")
    if not isinstance(transcript, str) or not 1 <= len(transcript) <= 6000 or not transcript.strip():
        raise ValueError("transcript must be nonblank text of at most 6000 characters")
    transcript_key = _lexical_key(transcript)
    if not transcript_key:
        raise ValueError("transcript must contain lexical text")
    if type(sample_rate) is not int or not 1 <= sample_rate <= 192000:
        raise ValueError("sample_rate is out of range")
    if type(clip_frames) is not int or clip_frames <= 0 or clip_frames > sample_rate * 120:
        raise ValueError("clip_frames is out of range")
    if not isinstance(source, str) or not 1 <= len(source) <= 128 or not source.strip():
        raise ValueError("source must be nonblank text of at most 128 characters")

    native: list[dict[str, Any]] = []
    normalized: list[tuple[str, float | None, float | None, bool]] = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"text", "start_time", "end_time"}:
            raise ValueError("native unit has invalid shape")
        text = item["text"]
        if not isinstance(text, str) or not text.strip() or not _lexical_key(text):
            raise ValueError("native unit text must be nonblank lexical text")
        start_time, bad_start = _time_value(item["start_time"])
        end_time, bad_end = _time_value(item["end_time"])
        native.append(_copy_json(item))
        normalized.append((text, start_time, end_time, bad_start or bad_end))

    if sentence_texts is None:
        if segmentation_source is not None:
            raise ValueError("segmentation_source requires sentence_texts")
        spans = _split_spans(transcript)
        segmentation = {"status": "punctuation_candidates" if len(spans) > 1 else "single_span_unverified", "method": "transcript_terminal_punctuation"}
    else:
        if type(sentence_texts) is not list or not 1 <= len(sentence_texts) <= 128:
            raise ValueError("sentence_texts must be a list of 1 to 128 texts")
        if any(type(text) is not str or not text.strip() or not _lexical_key(text) for text in sentence_texts):
            raise ValueError("sentence_texts must contain nonblank lexical text")
        if "".join(sentence_texts) != transcript:
            raise ValueError("sentence_texts must exactly concatenate to transcript")
        if type(segmentation_source) is not str or not 1 <= len(segmentation_source) <= 128 or not segmentation_source.strip():
            raise ValueError("segmentation_source must be nonblank text of at most 128 characters")
        if any(ord(character) <= 31 or 127 <= ord(character) <= 159 for character in segmentation_source):
            raise ValueError("segmentation_source contains control characters")
        spans = []
        cursor = 0
        for text in sentence_texts:
            end = cursor + len(text)
            spans.append((text, cursor, end))
            cursor = end
        segmentation = {"status": "semantic_candidates", "method": "exact_external_sentence_texts", "source": segmentation_source}
    if len(spans) > 128:
        raise ValueError("transcript has more than 128 sentence candidates")
    native_key = "".join(_lexical_key(unit[0]) for unit in normalized)
    coverage = "exact" if transcript_key == native_key else "mismatch"
    duration = clip_frames / sample_rate
    sentence_records: list[dict[str, Any]] = []

    if coverage == "exact":
        span_lengths = [len(_lexical_key(text)) for text, _, _ in spans]
        span_ranges = []
        cursor = 0
        for size in span_lengths:
            span_ranges.append((cursor, cursor + size))
            cursor += size
        unit_ranges = []
        cursor = 0
        for text, _, _, _ in normalized:
            size = len(_lexical_key(text))
            unit_ranges.append((cursor, cursor + size))
            cursor += size
        assignments: list[list[int]] = [[] for _ in spans]
        crossing: set[int] = set()
        for ui, (ua, ub) in enumerate(unit_ranges):
            covered = []
            for si, (sa, sb) in enumerate(span_ranges):
                if ua < sb and ub > sa:
                    assignments[si].append(ui)
                    covered.append(si)
                    if ua < sa or ub > sb:
                        crossing.add(si)
            if len(covered) > 1:
                crossing.update(covered)
        for index, ((span_text, text_start, text_end), indices) in enumerate(zip(spans, assignments)):
            sentence_records.append({"sentence_id": f"sentence-{index + 1}", "text": span_text, "text_start": text_start, "text_end": text_end, "status": "unavailable", "reason": "native_unit_crosses_sentence_boundary" if index in crossing else None, "start_sample": None, "end_sample": None, "start_ms": None, "end_ms": None, "unit_indices": indices, "zero_interval_count": sum(1 for ui in indices if normalized[ui][1] is not None and normalized[ui][2] is not None and normalized[ui][1] == normalized[ui][2])})

        edge_pairs = []
        for index, record in enumerate(sentence_records):
            indices = record["unit_indices"]
            bounds = []
            invalid = False
            previous_start = previous_end = None
            for ui in indices:
                _, start_time, end_time, tagged_invalid = normalized[ui]
                if tagged_invalid or start_time is None or end_time is None or start_time < 0 or end_time < start_time or end_time > duration:
                    invalid = True
                    break
                if previous_start is not None and (start_time < previous_start or end_time < previous_end):
                    invalid = True
                    break
                bounds.append((start_time, end_time))
                previous_start, previous_end = start_time, end_time
            if record["reason"] is None:
                if invalid or not bounds:
                    record["reason"] = "invalid_native_timing"
                else:
                    first_start, first_end = bounds[0]
                    last_start, last_end = bounds[-1]
                    if first_end <= first_start or last_end <= last_start:
                        record["reason"] = "invalid_boundary_unit"
                    else:
                        start_sample = round(first_start * sample_rate)
                        end_sample = round(last_end * sample_rate)
                        start_ms = round(first_start * 1000)
                        end_ms = round(last_end * 1000)
                        if not (0 <= start_sample < end_sample <= clip_frames and start_ms < end_ms):
                            record["reason"] = "rounded_invalid_bounds"
                        else:
                            record.update(status="candidate", start_sample=start_sample, end_sample=end_sample, start_ms=start_ms, end_ms=end_ms)
            # Use original finite native edge values even when sentence-internal validation failed.
            left_edge = normalized[indices[-1]][2] if indices else None
            right_edge = normalized[sentence_records[index + 1]["unit_indices"][0]][1] if index + 1 < len(sentence_records) and sentence_records[index + 1]["unit_indices"] else None
            edge_pairs.append((left_edge, right_edge))
        overlap_implicated: set[int] = set()
        for index, (left_end, right_start) in enumerate(edge_pairs):
            if left_end is not None and right_start is not None and math.isfinite(left_end) and math.isfinite(right_start) and right_start < left_end:
                overlap_implicated.update((index, index + 1))
        for index in overlap_implicated:
            record = sentence_records[index]
            record.update(status="unavailable", reason="overlapping_sentence_bounds", start_sample=None, end_sample=None, start_ms=None, end_ms=None)
    else:
        for index, (span_text, text_start, text_end) in enumerate(spans):
            sentence_records.append({"sentence_id": f"sentence-{index + 1}", "text": span_text, "text_start": text_start, "text_end": text_end, "status": "unavailable", "reason": "lexical_mismatch", "start_sample": None, "end_sample": None, "start_ms": None, "end_ms": None, "unit_indices": [], "zero_interval_count": 0})

    return {"schema_version": "sentence-0.1", "transcript": transcript, "sample_rate": sample_rate, "clip_frames": clip_frames, "coordinate": "original_clip_samples_and_python_codepoints", "source": source, "segmentation": segmentation, "coverage": coverage, "sentences": sentence_records, "native_units": native}
