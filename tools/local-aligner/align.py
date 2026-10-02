from __future__ import annotations

import argparse
import contextlib
import json
import math
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DEFAULT = Path("data/models/Qwen3-ForcedAligner-0.6B")
MODEL_FILES = ("config.json", "model.safetensors", "tokenizer_config.json")
SOURCE = "Qwen/Qwen3-ForcedAligner-0.6B"


class WorkerError(Exception):
    def __init__(self, code: str, message: str, diagnostics: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.diagnostics = diagnostics


def positive_threads(value: str) -> int:
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("threads must be an integer from 1 to 64") from exc
    if not 1 <= number <= 64:
        raise argparse.ArgumentTypeError("threads must be an integer from 1 to 64")
    return number


def project_path(value: str | Path) -> Path:
    path = Path(value)
    return (path if path.is_absolute() else PROJECT_ROOT / path).resolve()


def read_transcript(path: Path) -> str:
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise WorkerError("input_invalid", "Text file must be a readable UTF-8 file.") from exc
    if path.suffix.lower() == ".json":
        try:
            payload = json.loads(content)
        except (json.JSONDecodeError, UnicodeError) as exc:
            raise WorkerError("input_invalid", "JSON text file is invalid.") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("transcript"), str):
            raise WorkerError("input_invalid", "JSON must contain a nonblank transcript string.")
        transcript = payload["transcript"]
    else:
        transcript = content
    if not transcript.strip():
        raise WorkerError("input_invalid", "Transcript must not be blank.")
    return transcript


def load_audio(path: Path):
    if not path.is_file():
        raise WorkerError("input_invalid", "Audio path must name a readable local WAV file.")
    try:
        import numpy as np
        import soundfile as sf
        samples, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise WorkerError("input_invalid", "Audio must be a readable WAV file.") from exc
    if samples.ndim != 2 or samples.shape[1] != 1:
        raise WorkerError("input_invalid", "Audio must be mono.")
    samples = samples[:, 0]
    if sample_rate != 16000 or samples.size == 0:
        raise WorkerError("input_invalid", "Audio must be nonempty and sampled at 16000 Hz.")
    if not np.isfinite(samples).all():
        raise WorkerError("input_invalid", "Audio contains non-finite samples.")
    duration = samples.size / float(sample_rate)
    if duration > 120:
        raise WorkerError("input_invalid", "Audio duration must not exceed 120 seconds.")
    if not np.any(samples != 0):
        raise WorkerError("input_invalid", "Silent audio is not alignable.")
    return samples, int(sample_rate), duration


def lexical_key(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return "".join(ch for ch in normalized if not ch.isspace() and not unicodedata.category(ch).startswith("P"))


def map_alignment(items: Any, transcript: str, duration: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    mapped: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    if not isinstance(items, (list, tuple)):
        raise WorkerError("invalid_alignment", "Aligner returned an invalid unit list.", [])
    for item in items:
        try:
            unit_text = item.text
            start = item.start_time
            end = item.end_time
        except Exception:
            unit_text = getattr(item, "text", None)
            start = getattr(item, "start_time", None)
            end = getattr(item, "end_time", None)
        try:
            start_num = float(start)
            end_num = float(end)
            valid = (isinstance(unit_text, str) and bool(unit_text) and
                     math.isfinite(start_num) and math.isfinite(end_num) and
                     start_num >= 0 and end_num > start_num and end_num <= duration)
        except (TypeError, ValueError, OverflowError):
            start_num = end_num = math.nan
            valid = False
        if not valid:
            invalid.append({"text": unit_text, "start_time": start, "end_time": end})
        if isinstance(unit_text, str):
            granularity = "character" if len(unit_text) == 1 else "word"
        else:
            granularity = "word"
        mapped.append({"text": unit_text, "start_ms": round(start_num * 1000) if math.isfinite(start_num) else None,
                       "end_ms": round(end_num * 1000) if math.isfinite(end_num) else None,
                       "granularity": granularity})
    if invalid:
        return mapped, invalid
    joined = "".join(item["text"] for item in items if isinstance(getattr(item, "text", None), str))
    if lexical_key(joined) != lexical_key(transcript):
        raise WorkerError("invalid_alignment", "Aligned units do not cover the supplied transcript.", [])
    return mapped, []


def safe_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, WorkerError):
        return exc.code, exc.message
    if getattr(exc, "winerror", None) == 1455 or "1455" in str(getattr(exc, "args", "")):
        return "model_load_failed", "Local memory or pagefile is insufficient to load the model."
    return "model_load_failed", "The local aligner could not be loaded."


def run(args: argparse.Namespace) -> dict[str, Any]:
    audio_path = project_path(args.audio)
    text_path = project_path(args.text_file)
    model_dir = project_path(args.model_dir)
    transcript = read_transcript(text_path)
    samples, sample_rate, duration = load_audio(audio_path)
    if not model_dir.is_dir() or any(not (model_dir / name).is_file() for name in MODEL_FILES):
        raise WorkerError("model_missing", "The configured local model directory is incomplete.")

    try:
        with contextlib.redirect_stdout(sys.stderr):
            import torch
            torch.set_num_threads(args.threads)
            dtype = torch.float32 if args.dtype == "float32" else torch.float16
            device_name = "cpu"
            actual_backend = "cpu"
            adapter_name = None
            if args.device == "directml":
                try:
                    import torch_directml
                    matches = []
                    for index in range(torch_directml.device_count()):
                        name = torch_directml.device_name(index).rstrip("\x00")
                        if "RX 6950 XT" in name:
                            matches.append((index, name))
                    if len(matches) != 1:
                        raise WorkerError("backend_unavailable", "A unique RX 6950 XT DirectML device is required.")
                    device_index, device_name = matches[0]
                    directml_device = torch_directml.device(device_index)
                    actual_backend = "directml"
                    adapter_name = device_name
                except WorkerError:
                    raise
                except Exception as exc:
                    raise WorkerError("backend_unavailable", "The required DirectML device is unavailable.") from exc
            load_start = time.perf_counter()
            try:
                from qwen_asr import Qwen3ForcedAligner
                aligner = Qwen3ForcedAligner.from_pretrained(
                    str(model_dir), device_map="cpu", dtype=dtype,
                    attn_implementation="eager", local_files_only=True,
                    trust_remote_code=False, use_safetensors=True)
                if actual_backend == "directml":
                    aligner.model.to(directml_device)
                    aligner.device = directml_device
            except WorkerError:
                raise
            except Exception as exc:
                raise WorkerError("model_load_failed", "The local aligner could not be loaded.") from exc
            load_ms = round((time.perf_counter() - load_start) * 1000)
            inference_start = time.perf_counter()
            try:
                result = aligner.align(audio=(samples, sample_rate), text=transcript, language=args.language)
                items = result[0].items
            except Exception as exc:
                raise WorkerError("inference_failed", "The local alignment request failed.") from exc
            inference_ms = round((time.perf_counter() - inference_start) * 1000)
            units, invalid = map_alignment(items, transcript, duration)
            if invalid:
                raise WorkerError("invalid_alignment", "Aligner returned invalid time spans.", invalid)
        output: dict[str, Any] = {
            "status": "ok", "schema_version": "0.1", "transcript": transcript,
            "language": args.language, "duration_ms": round(duration * 1000), "units": units,
            "source": SOURCE,
            "backend": {"requested": args.device, "actual": actual_backend, "device": device_name,
                        "adapter": adapter_name},
            "torch_version": str(torch.__version__), "dtype": args.dtype,
            "load_ms": load_ms, "inference_ms": inference_ms,
        }
        return output
    except WorkerError:
        raise
    except Exception as exc:
        code, message = safe_error(exc)
        raise WorkerError(code, message) from exc


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Run local Qwen forced alignment on a WAV file.")
    ap.add_argument("--audio", required=True, help="Local mono 16 kHz WAV path")
    ap.add_argument("--text-file", required=True, help="UTF-8 transcript text or JSON file")
    ap.add_argument("--model-dir", default=str(MODEL_DEFAULT), help="Local model directory")
    ap.add_argument("--device", choices=("cpu", "directml"), default="cpu")
    ap.add_argument("--threads", type=positive_threads, default=6)
    ap.add_argument("--language", default="Chinese")
    ap.add_argument("--dtype", choices=("float32", "float16"), default="float32")
    return ap


def main() -> int:
    args = parser().parse_args()
    try:
        output = run(args)
    except WorkerError as exc:
        output = {"status": exc.code, "error": {"code": exc.code, "message": exc.message}}
        if exc.diagnostics is not None:
            output["diagnostics"] = {"invalid_units": exc.diagnostics}
        print(json.dumps(output, ensure_ascii=False, separators=(",", ":")))
        return 1
    except Exception as exc:
        code, message = safe_error(exc)
        print(json.dumps({"status": code, "error": {"code": code, "message": message}}, ensure_ascii=False,
                         separators=(",", ":")))
        return 1
    print(json.dumps(output, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())