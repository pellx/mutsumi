from __future__ import annotations

import math
import unicodedata
from typing import Any


def _lexical_key(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return "".join(
        character
        for character in normalized
        if not character.isspace() and not unicodedata.category(character).startswith("P")
    )


def _split_spans(transcript: str) -> list[tuple[str, int, int]]:
    spans: list[tuple[str, int, int]] = []
    length = len(transcript)
    start = 0
    index = 0
    terminal = "。！？!?\r\n"
    closers = "\"'”’」』】）》〉〕］｝】"

    def append_span(end: int) -> None:
        text = transcript[start:end]
        if _lexical_key(text):
            spans.append((text, start, end))

    while index < length:
        if transcript[index] in terminal:
            index += 1
            while index < length and transcript[index] in terminal:
                index += 1
            while index < length and transcript[index] in closers:
                index += 1
            append_span(index)
            start = index
        else:
            index += 1
    if start < length:
        append_span(length)
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


def map_sentence_bounds(
    items: list[dict[str, Any]],
    *,
    transcript: str,
    sample_rate: int,
    clip_frames: int,
    source: str,
) -> dict[str, Any]:
    if not isinstance(items, list) or len(items) > 6000:
        raise ValueError("items must be a list of at most 6000 units")
    if not isinstance(transcript, str) or not 1 <= len(transcript) <= 6000 or not transcript.strip():
        raise ValueError("transcript must be nonblank text of at most 6000 characters")
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

    spans = _split_spans(transcript)
    if len(spans) > 128:
        raise ValueError("transcript has more than 128 sentence candidates")
    transcript_key = _lexical_key(transcript)
    native_key = "".join(_lexical_key(unit[0]) for unit in normalized)
    coverage = "exact" if transcript_key == native_key else "mismatch"
    duration = clip_frames / sample_rate
    sentence_records: list[dict[str, Any]] = []

    if coverage == "exact" and spans:
        unit_cursor = 0
        lexical_cursor = 0
        assignments: list[list[int]] = []
        boundary_crossing: set[int] = set()
        for span_index, (span_text, _, _) in enumerate(spans):
            span_length = len(_lexical_key(span_text))
            span_end = lexical_cursor + span_length
            assigned: list[int] = []
            while unit_cursor < len(normalized) and lexical_cursor < span_end:
                unit_text_length = len(_lexical_key(normalized[unit_cursor][0]))
                next_cursor = lexical_cursor + unit_text_length
                assigned.append(unit_cursor)
                if next_cursor > span_end:
                    boundary_crossing.add(span_index)
                    if span_index + 1 < len(spans):
                        boundary_crossing.add(span_index + 1)
                lexical_cursor = next_cursor
                unit_cursor += 1
            assignments.append(assigned)
        for span_index, ((span_text, text_start, text_end), indices) in enumerate(zip(spans, assignments)):
            sentence_records.append({
                "sentence_id": f"sentence-{span_index + 1}",
                "text": span_text,
                "text_start": text_start,
                "text_end": text_end,
                "status": "unavailable",
                "reason": None,
                "start_sample": None,
                "end_sample": None,
                "start_ms": None,
                "end_ms": None,
                "unit_indices": indices,
                "zero_interval_count": sum(
                    1 for unit_index in indices
                    if normalized[unit_index][1] is not None
                    and normalized[unit_index][2] is not None
                    and normalized[unit_index][1] == normalized[unit_index][2]
                ),
            })
            if span_index in boundary_crossing:
                sentence_records[-1]["reason"] = "native_unit_crosses_sentence_boundary"

        for index, record in enumerate(sentence_records):
            if record["reason"] is not None:
                continue
            indices = record["unit_indices"]
            bounds: list[tuple[float, float]] = []
            invalid = False
            previous_start = previous_end = None
            for unit_index in indices:
                _, start_time, end_time, tagged_invalid = normalized[unit_index]
                if tagged_invalid or start_time is None or end_time is None or start_time < 0 or end_time < start_time or end_time > duration:
                    invalid = True
                    break
                if previous_start is not None and (start_time < previous_start or end_time < previous_end):
                    invalid = True
                    break
                bounds.append((start_time, end_time))
                previous_start, previous_end = start_time, end_time
            if invalid or not bounds:
                record["reason"] = "invalid_native_timing"
                continue
            first_start, first_end = bounds[0]
            last_start, last_end = bounds[-1]
            if first_end <= first_start or last_end <= last_start:
                record["reason"] = "invalid_boundary_unit"
                continue
            start_sample = round(first_start * sample_rate)
            end_sample = round(last_end * sample_rate)
            start_ms = round(first_start * 1000)
            end_ms = round(last_end * 1000)
            if not (0 <= start_sample < end_sample <= clip_frames and start_ms < end_ms):
                record["reason"] = "rounded_invalid_bounds"
                continue
            record.update(status="candidate", start_sample=start_sample, end_sample=end_sample, start_ms=start_ms, end_ms=end_ms)

        for index in range(1, len(sentence_records)):
            left = sentence_records[index - 1]
            right = sentence_records[index]
            if left["status"] == "candidate" and right["status"] == "candidate":
                left_end = normalized[left["unit_indices"][-1]][2]
                right_start = normalized[right["unit_indices"][0]][1]
                if right_start is not None and left_end is not None and right_start < left_end:
                    for record in (left, right):
                        record.update(status="unavailable", reason="overlapping_sentence_bounds", start_sample=None, end_sample=None, start_ms=None, end_ms=None)
    elif coverage == "mismatch":
        for index, (span_text, text_start, text_end) in enumerate(spans):
            sentence_records.append({
                "sentence_id": f"sentence-{index + 1}", "text": span_text,
                "text_start": text_start, "text_end": text_end,
                "status": "unavailable", "reason": "lexical_mismatch",
                "start_sample": None, "end_sample": None, "start_ms": None, "end_ms": None,
                "unit_indices": [], "zero_interval_count": 0,
            })

    return {
        "schema_version": "sentence-0.1",
        "transcript": transcript,
        "sample_rate": sample_rate,
        "clip_frames": clip_frames,
        "coordinate": "original_clip_samples_and_python_codepoints",
        "source": source,
        "segmentation": {
            "status": "punctuation_candidates" if len(spans) > 1 else "single_span_unverified",
            "method": "transcript_terminal_punctuation",
        },
        "coverage": coverage,
        "sentences": sentence_records,
        "native_units": native,
    }