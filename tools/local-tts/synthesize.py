#!/usr/bin/env python3
"""Offline, CPU-only Qwen3-TTS preset voice worker."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import stat
import sys
import time
from importlib import metadata
from pathlib import Path
from typing import Any

MODEL_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
MODEL_REVISION = "0c0e3051f131929182e2c023b9537f8b1c68adfe"
MODEL_HASHES = {
    "model.safetensors": "38b1d5971bdbd982b561cccec982669a53b0537c3cf5e9bd4778ed07bb2f5137",
    "speech_tokenizer/model.safetensors": "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258",
}
SPEAKERS = ("Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee")
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = Path("data/models/Qwen3-TTS-12Hz-1.7B-CustomVoice")
MAX_REQUEST_BYTES = 8192
MIN_FREE_BYTES = 32 * 1024 * 1024

class WorkerError(Exception):
    def __init__(self, code: str):
        self.code = code


def emit_error(code: str) -> int:
    print(json.dumps({"error": code}, separators=(",", ":")))
    return 1


def has_reparse_or_symlink(path: Path) -> bool:
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.parts[0])
    for part in absolute.parts[1:]:
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            continue
        except OSError:
            raise WorkerError("path_invalid") from None
        attrs = getattr(info, "st_file_attributes", 0)
        reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        if stat.S_ISLNK(info.st_mode) or attrs & reparse:
            return True
    return False


def safe_path(value: str, *, must_exist: bool, reject_links: bool = True) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    candidate = Path(os.path.abspath(candidate))
    if reject_links and has_reparse_or_symlink(candidate):
        raise WorkerError("path_invalid")
    if must_exist and not candidate.exists():
        raise WorkerError("path_missing")
    return candidate


def read_request(path: Path) -> dict[str, str]:
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_REQUEST_BYTES + 1)
    except OSError:
        raise WorkerError("request_unreadable") from None
    if len(raw) > MAX_REQUEST_BYTES:
        raise WorkerError("request_too_large")
    try:
        decoded = raw.decode("utf-8", errors="strict")
    except UnicodeError:
        raise WorkerError("request_invalid") from None

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise WorkerError("request_invalid")
            result[key] = value
        return result

    def bad_constant(_: str) -> None:
        raise WorkerError("request_invalid")

    try:
        obj = json.loads(decoded, object_pairs_hook=pairs, parse_constant=bad_constant)
    except WorkerError:
        raise
    except (ValueError, TypeError, RecursionError):
        raise WorkerError("request_invalid") from None
    if type(obj) is not dict or set(obj) != {"text", "speaker", "instruct"}:
        raise WorkerError("request_invalid")
    if any(type(obj[k]) is not str for k in obj):
        raise WorkerError("request_invalid")
    text, speaker, instruct = obj["text"], obj["speaker"], obj["instruct"]
    if not (1 <= len(text) <= 200) or not text.strip() or len(instruct) > 240 or speaker not in SPEAKERS:
        raise WorkerError("request_invalid")
    for value in (text, speaker, instruct):
        for char in value:
            cp = ord(char)
            if cp < 32 and char not in "\t\n\r" or 127 <= cp <= 159 or 0xD800 <= cp <= 0xDFFF:
                raise WorkerError("request_invalid")
    return obj


def check_model(model: Path) -> None:
    if not model.is_dir():
        raise WorkerError("model_missing")
    required = (
        "config.json", "generation_config.json", "preprocessor_config.json",
        "tokenizer_config.json", "merges.txt", "vocab.json", "model.safetensors",
        "speech_tokenizer/config.json", "speech_tokenizer/configuration.json",
        "speech_tokenizer/preprocessor_config.json", "speech_tokenizer/model.safetensors",
    )
    for name in required:
        file_path = model / name
        if has_reparse_or_symlink(file_path):
            raise WorkerError("path_invalid")
        if not file_path.is_file():
            raise WorkerError("model_missing")
    try:
        config = json.loads((model / "config.json").read_text(encoding="utf-8"))
        if type(config) is not dict:
            raise WorkerError("model_invalid")
        if (config.get("model_type"), config.get("tts_model_type"), config.get("tts_model_size")) != ("qwen3_tts", "custom_voice", "1b7"):
            raise WorkerError("model_invalid")
    except WorkerError:
        raise
    except (OSError, ValueError, TypeError):
        raise WorkerError("model_invalid") from None
    for name, expected in MODEL_HASHES.items():
        digest = hashlib.sha256()
        try:
            with (model / name).open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
        except OSError:
            raise WorkerError("model_missing") from None
        if digest.hexdigest() != expected:
            raise WorkerError("model_hash_mismatch")


def finite_number(value: Any) -> tuple[float, float, Any]:
    try:
        import numpy as np
        arr = np.asarray(value)
        if arr.size == 0 or arr.ndim != 1 or arr.dtype.kind != "f" or not bool(np.isfinite(arr).all()):
            raise WorkerError("audio_invalid")
        peak = float(np.max(np.abs(arr)))
        rms = float(np.sqrt(np.mean(np.square(arr, dtype=np.float64))))
        if peak <= 0.0 or peak > 1.0 or not math.isfinite(rms):
            raise WorkerError("audio_invalid")
        return peak, rms, arr
    except WorkerError:
        raise
    except Exception:
        raise WorkerError("audio_invalid") from None


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        print('{"error":"argument_invalid"}')
        raise SystemExit(1)


def check_runtime_versions() -> None:
    expected = {"qwen-tts": "0.1.1", "transformers": "4.57.3", "torch": "2.10.0+cpu"}
    try:
        for package, version in expected.items():
            if metadata.version(package) != version:
                raise WorkerError("runtime_version_mismatch")
    except metadata.PackageNotFoundError:
        raise WorkerError("runtime_version_mismatch") from None


def main(argv: list[str] | None = None) -> int:
    parser = JsonArgumentParser(description="Offline CPU-only Qwen3-TTS preset voice synthesis")
    parser.add_argument("--request-file", required=True, help="UTF-8 JSON request file")
    parser.add_argument("--output-dir", required=True, help="New or empty output directory")
    parser.add_argument("--model-dir", default=str(DEFAULT_MODEL), help="Local pinned model directory")
    parser.add_argument("--device", choices=("cpu",), default="cpu")
    parser.add_argument("--threads", type=int, choices=range(1, 25), default=6)
    parser.add_argument("--max-new-tokens", type=int, choices=range(32, 513), default=256)
    args = parser.parse_args(argv)
    owned: list[Path] = []
    try:
        request_path = safe_path(args.request_file, must_exist=True)
        model_path = safe_path(args.model_dir, must_exist=False)
        if not model_path.exists():
            raise WorkerError("model_missing")
        output_path = safe_path(args.output_dir, must_exist=False)
        if request_path.is_dir() or not request_path.is_file():
            raise WorkerError("request_unreadable")
        if output_path.exists() and (not output_path.is_dir() or any(output_path.iterdir())):
            raise WorkerError("output_not_empty")
        try:
            if os.path.commonpath((str(output_path), str(model_path))) == str(model_path):
                raise WorkerError("output_in_model")
        except ValueError:
            pass
        request = read_request(request_path)
        check_model(model_path)
        check_runtime_versions()
        output_path.mkdir(parents=True, exist_ok=True)
        if shutil_disk_free(output_path) < MIN_FREE_BYTES:
            raise WorkerError("disk_space_low")

        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        load_start = time.monotonic()
        with contextlib.redirect_stdout(sys.stderr):
            import torch
            from qwen_tts import Qwen3TTSModel
            torch.set_num_threads(args.threads)
            model = Qwen3TTSModel.from_pretrained(
                str(model_path), device_map="cpu", dtype=torch.float32,
                attn_implementation="eager", local_files_only=True,
                trust_remote_code=False, use_safetensors=True,
            )
        load_ms = (time.monotonic() - load_start) * 1000.0
        inference_start = time.monotonic()
        with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
            result = model.generate_custom_voice(
                text=request["text"], language="Chinese", speaker=request["speaker"],
                instruct=request["instruct"], max_new_tokens=args.max_new_tokens,
                non_streaming_mode=True,
            )
        inference_ms = (time.monotonic() - inference_start) * 1000.0
        if type(result) not in (tuple, list) or len(result) != 2:
            raise WorkerError("audio_invalid")
        wavs, rate = result
        if type(rate) is not int or rate != 24000 or type(wavs) not in (tuple, list) or len(wavs) != 1:
            raise WorkerError("audio_invalid")
        peak, rms, samples = finite_number(wavs[0])
        frames = int(samples.shape[0])
        duration = frames / 24000.0
        if frames <= 0 or duration > 60.0:
            raise WorkerError("audio_invalid")
        write_start = time.monotonic()
        wav_path = output_path / "output.wav"
        try:
            wav_stream = wav_path.open("xb")
            owned.append(wav_path)
            with wav_stream:
                with contextlib.redirect_stdout(sys.stderr):
                    import soundfile as sf
                    sf.write(wav_stream, samples, 24000, subtype="FLOAT", format="WAV")
                wav_stream.flush()
                os.fsync(wav_stream.fileno())
        except FileExistsError:
            raise WorkerError("output_exists") from None
        except WorkerError:
            raise
        except Exception:
            raise WorkerError("write_failed") from None
        write_ms = (time.monotonic() - write_start) * 1000.0
        manifest = {
            "text": request["text"], "speaker": request["speaker"], "instruct": request["instruct"],
            "model": {"repo": MODEL_REPO, "revision": MODEL_REVISION, "hashes": MODEL_HASHES},
            "device": "cpu", "precision": "FP32", "threads": args.threads,
            "max_new_tokens": args.max_new_tokens, "attention": "eager",
            "synthesized": True, "sample_rate": 24000, "frames": frames,
            "duration_seconds": duration, "peak": peak, "rms": rms,
            "load_ms": load_ms, "inference_ms": inference_ms, "write_ms": write_ms,
            "quality": "owner_listening_pending", "completion": "not_verified",
            "timestamps": "unavailable", "emotion_control": "requested_not_verified",
            "precision_of_intensity": "unavailable", "precision_of_pace": "unavailable",
            "precision_of_pause": "unavailable",
        }
        manifest_path = output_path / "synthesis.json"
        try:
            with manifest_path.open("x", encoding="utf-8", newline="\n") as stream:
                owned.append(manifest_path)
                json.dump(manifest, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
        except FileExistsError:
            raise WorkerError("output_exists") from None
        except Exception:
            raise WorkerError("write_failed") from None
        print(json.dumps(manifest, ensure_ascii=True, separators=(",", ":"), allow_nan=False))
        return 0
    except WorkerError as exc:
        for artifact in owned:
            try:
                artifact.unlink()
            except OSError:
                pass
        return emit_error(exc.code)
    except KeyboardInterrupt:
        for artifact in owned:
            try:
                artifact.unlink()
            except OSError:
                pass
        return emit_error("interrupted")
    except Exception:
        for artifact in owned:
            try:
                artifact.unlink()
            except OSError:
                pass
        return emit_error("runtime_failed")


def shutil_disk_free(path: Path) -> int:
    import shutil
    return shutil.disk_usage(path).free

if __name__ == "__main__":
    raise SystemExit(main())
