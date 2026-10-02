"""Propose sentence groupings at long gaps in native speech units.

These local timing based candidates are not verified semantic or prosodic
sentence boundaries.
"""
import math
import unicodedata


def _lexical(value):
    normalized = unicodedata.normalize("NFC", value)
    return "".join(
        character
        for character in normalized
        if not character.isspace()
        and not unicodedata.category(character).startswith("P")
    )


def _exact_int(value, minimum, maximum=None):
    return (
        type(value) is int
        and value >= minimum
        and (maximum is None or value <= maximum)
    )


def propose_pause_sentences(
    items,
    *,
    transcript,
    sample_rate,
    clip_frames,
    pause_threshold_ms=600,
):
    """Group exact transcript text using sufficiently long native-unit gaps."""
    if type(items) is not list or len(items) > 6000:
        raise ValueError("invalid native items")
    if type(transcript) is not str or not 1 <= len(transcript) <= 6000:
        raise ValueError("invalid transcript")
    if not _lexical(transcript):
        raise ValueError("transcript has no lexical content")
    if not _exact_int(sample_rate, 1, 192000):
        raise ValueError("invalid sample rate")
    if not _exact_int(clip_frames, 1, sample_rate * 120):
        raise ValueError("invalid clip length")
    if not _exact_int(pause_threshold_ms, 100, 3000):
        raise ValueError("invalid pause threshold")
    if not items:
        raise ValueError("native items are empty")

    duration = clip_frames / sample_rate
    native_lexical = []
    checked = []
    previous_start = -math.inf
    previous_end = -math.inf
    for item in items:
        if type(item) is not dict or set(item) != {"text", "start_time", "end_time"}:
            raise ValueError("invalid native item shape")
        text = item["text"]
        if type(text) is not str or not _lexical(text):
            raise ValueError("native item has no lexical text")
        start = item["start_time"]
        end = item["end_time"]
        if type(start) not in (int, float) or type(end) not in (int, float):
            raise ValueError("invalid native timing")
        if not math.isfinite(start) or not math.isfinite(end):
            raise ValueError("invalid native timing")
        if not 0 <= start <= end <= duration:
            raise ValueError("native timing outside clip")
        if start < previous_start or end < previous_end:
            raise ValueError("native timing is not nondecreasing")
        previous_start = start
        previous_end = end
        native_lexical.append(_lexical(text))
        checked.append((text, start, end))

    complete_lexical = "".join(native_lexical)
    if complete_lexical != _lexical(transcript):
        raise ValueError("native text does not cover transcript")

    cumulative = []
    running = ""
    for value in native_lexical:
        running += value
        cumulative.append(running)

    gaps = []
    unavailable = []
    offsets = []
    threshold_seconds = pause_threshold_ms / 1000
    for index in range(len(checked) - 1):
        _, start, end = checked[index]
        _, next_start, next_end = checked[index + 1]
        if end == start or next_end == next_start:
            unavailable.append({
                "after_unit_index": index,
                "before_unit_index": index + 1,
                "reason": "zero_interval_edge",
            })
            continue
        raw_gap = next_start - end
        if raw_gap < 0 or raw_gap + 1e-9 < threshold_seconds:
            continue

        left = cumulative[index]
        right = complete_lexical[len(left):]
        matches = [
            offset
            for offset in range(1, len(transcript))
            if unicodedata.normalize("NFC", transcript[:offset])
            and (offset == 0 or not unicodedata.category(transcript[offset]).startswith("M"))
            and _lexical(transcript[:offset]) == left
            and _lexical(transcript[offset:]) == right
        ]
        if not matches:
            raise ValueError("pause boundary cannot map to transcript text")
        offset = max(matches)
        offsets.append(offset)
        gaps.append({
            "after_unit_index": index,
            "before_unit_index": index + 1,
            "start_ms": round(end * 1000),
            "end_ms": round(next_start * 1000),
            "gap_ms": round(raw_gap * 1000),
            "split_text_offset": offset,
        })

    if len(gaps) + 1 > 128:
        raise ValueError("too many proposed sentence spans")
    boundaries = [0, *offsets, len(transcript)]
    sentence_texts = [
        transcript[left:right]
        for left, right in zip(boundaries, boundaries[1:])
    ]
    if any(not _lexical(sentence) for sentence in sentence_texts):
        raise ValueError("pause boundary creates empty sentence text")
    if "".join(sentence_texts) != transcript:
        raise ValueError("sentence text coverage is not exact")

    return {
        "source": "local_native_pause_candidates",
        "sentence_texts": sentence_texts,
        "pause_threshold_ms": pause_threshold_ms,
        "coverage": "exact",
        "gaps": gaps,
        "unavailable_gap_edges": unavailable,
    }
