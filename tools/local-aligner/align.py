from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
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
    if not lexical_key(transcript):
        raise WorkerError("input_invalid", "Transcript must contain spoken lexical content.")
    return transcript


def load_audio(path: Path):
    if not path.is_file():
        raise WorkerError("input_invalid", "Audio path must name a readable local WAV file.")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import numpy as np
            import soundfile as sf
            info = sf.info(str(path))
            if info.format not in ("WAV", "WAVEX", "RF64"):
                raise WorkerError("input_invalid", "Audio file content must be WAV, WAVEX, or RF64 format.")
            samples, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except WorkerError:
        raise
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


def raw_json_value(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            tag = "NaN"
        elif value > 0:
            tag = "Infinity"
        else:
            tag = "-Infinity"
        return {"non_finite": tag}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [raw_json_value(part) for part in value]
    if isinstance(value, dict):
        return {str(key): raw_json_value(part) for key, part in value.items()}
    return str(value)


def raw_units(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, (list, tuple)):
        return []
    result = []
    for item in items:
        result.append({
            "text": raw_json_value(getattr(item, "text", None)),
            "start_time": raw_json_value(getattr(item, "start_time", None)),
            "end_time": raw_json_value(getattr(item, "end_time", None)),
        })
    return result


def map_alignment(items: Any, transcript: str, duration: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(items, (list, tuple)):
        raise WorkerError("invalid_alignment", "Aligner returned an invalid unit list.", [])
    diagnostics = raw_units(items)
    if not items:
        raise WorkerError("invalid_alignment", "Aligner returned no alignment units.", diagnostics)
    mapped: list[dict[str, Any]] = []
    invalid = False
    texts: list[str] = []
    for item in items:
        try:
            unit_text = item.text
            start = item.start_time
            end = item.end_time
        except Exception:
            unit_text = getattr(item, "text", None)
            start = getattr(item, "start_time", None)
            end = getattr(item, "end_time", None)
        numeric = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool)
        valid = isinstance(unit_text, str) and bool(unit_text.strip()) and numeric(start) and numeric(end)
        if valid:
            start_num, end_num = float(start), float(end)
            if math.isfinite(start_num) and math.isfinite(end_num):
                start_ms, end_ms = round(start_num * 1000), round(end_num * 1000)
                valid = (start_num >= 0 and end_num > start_num and end_num <= duration and
                         start_ms >= 0 and end_ms > start_ms and end_ms <= round(duration * 1000))
            else:
                valid = False
        else:
            start_num = end_num = 0.0
            start_ms = end_ms = 0
        if not valid:
            invalid = True
        if isinstance(unit_text, str):
            texts.append(unit_text)
            granularity = "character" if len(unit_text) == 1 else "word"
        else:
            granularity = "word"
        mapped.append({"text": unit_text, "start_ms": start_ms if valid else None,
                       "end_ms": end_ms if valid else None, "granularity": granularity})
    if not items or not lexical_key(transcript) or not lexical_key("".join(texts)):
        invalid = True
    if not invalid and lexical_key("".join(texts)) != lexical_key(transcript):
        invalid = True
    if invalid:
        return mapped, diagnostics
    return mapped, []


def has_1455(exc: BaseException) -> bool:
    pending = [exc]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if getattr(current, "winerror", None) == 1455:
            return True
        if any("1455" in str(arg) for arg in getattr(current, "args", ())):
            return True
        if "1455" in str(getattr(current, "__dict__", {})):
            return True
        for nested in (getattr(current, "__cause__", None), getattr(current, "__context__", None)):
            if isinstance(nested, BaseException):
                pending.append(nested)
    return False


def memory_error(code: str) -> WorkerError:
    return WorkerError(code, "Local memory or pagefile is insufficient to load or run the model.")


def safe_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, WorkerError):
        return exc.code, exc.message
    if has_1455(exc):
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

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import torch
            torch.set_num_threads(args.threads)
            dtype = torch.float32 if args.dtype == "float32" else torch.float16
            device_name = "cpu"
            actual_backend = "cpu"
            adapter_name = None
            directml_device = None
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
                    if has_1455(exc):
                        raise memory_error("backend_unavailable") from exc
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
                if has_1455(exc):
                    raise memory_error("model_load_failed") from exc
                raise WorkerError("model_load_failed", "The local aligner could not be loaded.") from exc
            load_ms = round((time.perf_counter() - load_start) * 1000)
            inference_start = time.perf_counter()
            try:
                result = aligner.align(audio=(samples, sample_rate), text=transcript, language=args.language)
                items = result[0].items
            except Exception as exc:
                if has_1455(exc):
                    raise memory_error("inference_failed") from exc
                raise WorkerError("inference_failed", "The local alignment request failed.") from exc
            inference_ms = round((time.perf_counter() - inference_start) * 1000)
            try:
                units, invalid = map_alignment(items, transcript, duration)
            except WorkerError:
                raise
            except Exception as exc:
                raise WorkerError("invalid_alignment", "Aligner returned invalid time spans.", raw_units(items)) from exc
            if invalid:
                raise WorkerError("invalid_alignment", "Aligner returned invalid time spans or lexical coverage.", invalid)
        return {
            "status": "ok", "schema_version": "0.1", "transcript": transcript,
            "language": args.language, "duration_ms": round(duration * 1000), "units": units,
            "source": SOURCE,
            "backend": {"requested": args.device, "actual": actual_backend, "device": device_name,
                        "adapter": adapter_name},
            "torch_version": str(torch.__version__), "dtype": args.dtype,
            "load_ms": load_ms, "inference_ms": inference_ms,
        }
    except WorkerError:
        raise
    except Exception as exc:
        if has_1455(exc):
            raise memory_error("model_load_failed") from exc
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
    original_stdout = sys.stdout
    if hasattr(original_stdout, "reconfigure"):
        original_stdout.reconfigure(encoding="utf-8")
    args = parser().parse_args()
    try:
        output = run(args)
    except WorkerError as exc:
        output = {"status": exc.code, "error": {"code": exc.code, "message": exc.message}}
        if exc.diagnostics is not None:
            output["diagnostics"] = {"invalid_units": exc.diagnostics}
        print(json.dumps(output, ensure_ascii=False, separators=(",", ":"), allow_nan=False), file=original_stdout)
        return 1
    except Exception as exc:
        code, message = safe_error(exc)
        output = {"status": code, "error": {"code": code, "message": message}}
        print(json.dumps(output, ensure_ascii=False, separators=(",", ":"), allow_nan=False), file=original_stdout)
        return 1
    print(json.dumps(output, ensure_ascii=False, separators=(",", ":"), allow_nan=False), file=original_stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
