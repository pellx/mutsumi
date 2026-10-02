from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

from align import MODEL_DEFAULT, MODEL_FILES, PROJECT_ROOT, SOURCE, WorkerError, lexical_key, load_audio, project_path, raw_units
from sentence_result import map_sentence_bounds
from pause_sentences import propose_pause_sentences

RATE = 16000


def bounded_int(low: int, high: int, label: str):
    def parse(value: str) -> int:
        try:
            result = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"{label} must be an integer from {low} to {high}") from exc
        if not low <= result <= high:
            raise argparse.ArgumentTypeError(f"{label} must be an integer from {low} to {high}")
        return result
    return parse


def fail(code: str, message: str, diagnostics: Any = None):
    raise WorkerError(code, message, diagnostics)


def read_text(path: Path) -> str:
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        fail("input_invalid", "Text file must be readable UTF-8.")
    if path.suffix.lower() == ".json":
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeError):
            fail("input_invalid", "JSON text file is invalid.")
        if type(payload) is not dict or set(payload) != {"transcript"} or type(payload["transcript"]) is not str:
            fail("input_invalid", "JSON must be exactly an object with a transcript string.")
        raw = payload["transcript"]
    if not raw.strip() or len(raw) > 6000 or not lexical_key(raw):
        fail("input_invalid", "Transcript must contain lexical text of at most 6000 characters.")
    return raw


def invoke(aligner, samples, text, source, frame_count, *, single_part=False):
    started = time.perf_counter()
    result = aligner.align(audio=(samples, RATE), text=text, language="Chinese")
    elapsed = round((time.perf_counter() - started) * 1000)
    items = result[0].items
    native = raw_units(items)
    try:
        if single_part:
            mapped = map_sentence_bounds(native, transcript=text, sample_rate=RATE, clip_frames=frame_count,
                source=SOURCE, sentence_texts=[text], segmentation_source="crop_local_single_part")
        else:
            mapped = map_sentence_bounds(native, transcript=text, sample_rate=RATE, clip_frames=frame_count, source=SOURCE)
    except Exception:
        return None, native, elapsed, "mapping_failed"
    return mapped, native, elapsed, None


def run(args):
    audio_path, text_path, model_dir, output_dir = (project_path(v) for v in (args.audio, args.text_file, args.model_dir, args.output_dir))
    if not text_path.is_file():
        fail("input_invalid", "Text path must name a readable file.")
    transcript = read_text(text_path)
    samples, rate, duration = load_audio(audio_path)
    frames = len(samples)
    if not model_dir.is_dir() or any(not (model_dir / name).is_file() for name in MODEL_FILES):
        fail("model_missing", "The configured local model directory is incomplete.")
    if output_dir.exists() and (not output_dir.is_dir() or any(output_dir.iterdir())):
        fail("input_invalid", "Output directory must be new or empty.")

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    import numpy as np
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        torch.set_num_threads(args.threads)
        load_started = time.perf_counter()
        try:
            from qwen_asr import Qwen3ForcedAligner
            aligner = Qwen3ForcedAligner.from_pretrained(str(model_dir), device_map="cpu", dtype=torch.float32,
                attn_implementation="eager", local_files_only=True, trust_remote_code=False, use_safetensors=True)
        except Exception:
            fail("model_load_failed", "The local aligner could not be loaded.")
        load_ms = round((time.perf_counter() - load_started) * 1000)
        try:
            coarse, native, coarse_ms, problem = invoke(aligner, samples, transcript, SOURCE, frames)
        except Exception:
            fail("inference_failed", "The local alignment request failed.")

    if coarse is None or problem:
        diagnostics = {"native_units": native, "reason": "coarse_mapping_failed"}
        fail("segmentation_unavailable", "Whole-clip lexical mapping is unavailable.", diagnostics)
    punctuation = coarse["segmentation"]
    gaps = {"gaps": [], "unavailable_gap_edges": []}
    if punctuation["status"] == "punctuation_candidates":
        parts = [s["text"] for s in coarse["sentences"]]
        segmentation_source = "transcript_terminal_punctuation"
    else:
        try:
            proposal = propose_pause_sentences(native, transcript=transcript, sample_rate=RATE,
                clip_frames=frames, pause_threshold_ms=args.pause_threshold_ms)
            parts = proposal["sentence_texts"]
            gaps = {"gaps": proposal["gaps"], "unavailable_gap_edges": proposal["unavailable_gap_edges"]}
            segmentation_source = "local_native_pause_candidates"
        except Exception:
            fail("segmentation_unavailable", "Local native pause segmentation is unavailable.",
                 {"native_units": native, "coarse": coarse})
    if len(parts) > 128 or "".join(parts) != transcript:
        fail("segmentation_unavailable", "Sentence parts do not exactly cover the transcript.", {"native_units": native, "coarse": coarse})
    try:
        selected = map_sentence_bounds(native, transcript=transcript, sample_rate=RATE, clip_frames=frames,
            source=SOURCE, sentence_texts=parts, segmentation_source=segmentation_source)
    except Exception:
        fail("segmentation_unavailable", "Selected sentence boundaries could not be mapped.", {"native_units": native, "coarse": coarse})
    selected["segmentation"]["gap_evidence"] = gaps

    refinements = []
    timing_reasons = {"invalid_boundary_unit", "invalid_native_timing", "rounded_invalid_bounds", "overlapping_sentence_bounds"}
    for index, record in enumerate(selected["sentences"]):
        if record["status"] == "candidate":
            continue
        if record.get("reason") not in timing_reasons:
            refinements.append({"sentence_id": record["sentence_id"], "status": "unavailable", "reason": "ineligible_non_timing_rejection",
                "coarse_rejection": record.get("reason")})
            continue
        owned = record["unit_indices"]
        starts = [native[i]["start_time"] for i in owned]
        if (not owned or any(type(x) not in (int, float) or not math.isfinite(x) or x < 0 or x > duration for x in starts)
                or any(right < left for left, right in zip(starts, starts[1:]))):
            refinements.append({"sentence_id": record["sentence_id"], "status": "unavailable", "reason": "ineligible_edge_starts",
                "coarse_rejection": record.get("reason"), "original_reason": record.get("reason")})
            continue
        next_start = None
        if index + 1 < len(selected["sentences"]):
            next_owned = selected["sentences"][index + 1]["unit_indices"]
            if next_owned:
                candidate = native[next_owned[0]]["start_time"]
                if type(candidate) in (int, float) and math.isfinite(candidate) and candidate > starts[0]:
                    next_start = candidate
        begin = round(starts[0] * RATE) - args.crop_margin_ms * RATE // 1000
        end = round(next_start * RATE) if next_start is not None else frames
        begin = max(0, min(frames, begin))
        end = max(0, min(frames, end))
        if not 0 <= begin < end <= frames:
            refinements.append({"sentence_id": record["sentence_id"], "status": "unavailable", "reason": "empty_inference_window",
                "coarse_rejection": record.get("reason"), "original_reason": record.get("reason")})
            continue
        try:
            with contextlib.redirect_stdout(sys.stderr):
                crop_map, crop_native, elapsed, issue = invoke(aligner, samples[begin:end], record["text"], SOURCE, end - begin, single_part=True)
            crop_record = crop_map["sentences"][0] if crop_map and len(crop_map["sentences"]) == 1 and crop_map["coverage"] == "exact" else None
            refinements.append({"sentence_id": record["sentence_id"], "status": "attempted", "window_start_sample": begin,
                "window_end_sample": end, "window_clamped": begin != round(starts[0] * RATE) - args.crop_margin_ms * RATE // 1000,
                "crop_native_units": crop_native, "crop_map": crop_map, "elapsed_ms": elapsed, "coarse_rejection": record["reason"],
                "original_reason": record["reason"]})
            if crop_record and crop_record["status"] == "candidate":
                left = begin + crop_record["start_sample"]
                right = begin + crop_record["end_sample"]
                if 0 <= left < right <= frames:
                    record.update(status="candidate", reason=None, start_sample=left, end_sample=right,
                        start_ms=round(left * 1000 / RATE), end_ms=round(right * 1000 / RATE))
        except Exception:
            refinements.append({"sentence_id": record["sentence_id"], "status": "unavailable", "reason": "inference_failed",
                "coarse_rejection": record.get("reason"), "original_reason": record.get("reason")})
    overlaps = set()
    records = selected["sentences"]
    for i in range(len(records) - 1):
        a, b = records[i], records[i + 1]
        if a["status"] == b["status"] == "candidate" and b["start_sample"] < a["end_sample"]:
            overlaps.update((i, i + 1))
    for i in overlaps:
        records[i].update(status="unavailable", reason="overlapping_sentence_bounds", start_sample=None, end_sample=None, start_ms=None, end_ms=None)
    selected["status"] = "ok" if all(x["status"] == "candidate" for x in records) else "partial"
    selected["schema_version"] = "auto-sentence-0.1"
    selected.update(backend="cpu", model=SOURCE, load_ms=load_ms, coarse_inference_ms=coarse_ms,
        refinement_diagnostics=refinements, quality="boundary_listening_pending")
    selected["native_units"] = native

    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        import soundfile as sf
        for record in records:
            if record["status"] == "candidate":
                name = record["sentence_id"] + ".wav"
                with (output_dir / name).open("xb") as wav_stream:
                    sf.write(wav_stream, samples[record["start_sample"]:record["end_sample"]], RATE,
                        subtype="FLOAT", format="WAV")
                record["audio_file"] = name
        target = output_dir / "sentences.json"
        with target.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(selected, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
    except Exception:
        fail("output_failed", "Could not exclusively write sentence outputs.", selected)
    return selected


def parser():
    ap = argparse.ArgumentParser(description="Create local sentence boundaries and exact audio slices.")
    ap.add_argument("--audio", required=True)
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--model-dir", default=str(MODEL_DEFAULT))
    ap.add_argument("--threads", type=bounded_int(1, 64, "threads"), default=6)
    ap.add_argument("--pause-threshold-ms", type=bounded_int(100, 3000, "pause threshold"), default=600)
    ap.add_argument("--crop-margin-ms", type=bounded_int(0, 500, "crop margin"), default=150)
    return ap


def main():
    out = sys.stdout
    if hasattr(out, "reconfigure"):
        out.reconfigure(encoding="utf-8")
    args = parser().parse_args()
    try:
        value = run(args)
        code = 0
    except WorkerError as exc:
        value = {"status": exc.code, "error": {"code": exc.code, "message": exc.message}}
        if exc.diagnostics is not None:
            value["diagnostics"] = exc.diagnostics
        code = 1
    except Exception:
        value = {"status": "inference_failed", "error": {"code": "inference_failed", "message": "Local sentence processing failed."}}
        code = 1
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False), file=out)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
