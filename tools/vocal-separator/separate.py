from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_DEFAULT = Path("data/models/HTDemucs")
WEIGHT_NAME = "955717e8.safetensors"
WEIGHT_SHA256 = "d9fa14133cfcc034a6758923bb3a8ca9f8dfd0b582134643bbf83f72c17576dd"
REPOSITORY = "adefossez/HTDemucs"
REVISION = "cbc8a9b1a87023b7fd74e7b3412e6321c0eab003"
LABELS = ("drums", "bass", "other", "vocals")
OUTPUT_NAMES = ("vocals.wav", "accompaniment.wav", "vocals-analysis.wav", "separation.json")
MESSAGES = {
    "input_invalid": "Audio input is invalid or outside the supported limits.",
    "model_missing": "The pinned local separation model is missing.",
    "model_integrity_failed": "The local separation model failed integrity validation.",
    "backend_unavailable": "The required local CPU backend is unavailable.",
    "model_load_failed": "The pinned local separation model could not be loaded.",
    "inference_failed": "Local vocal separation failed.",
    "output_failed": "Separation outputs could not be written safely.",
}

class WorkerError(Exception):
    def __init__(self, code: str):
        self.code = code
        self.message = MESSAGES[code]
        super().__init__(self.message)

def positive_threads(value: str) -> int:
    if not value.isascii() or not value.isdecimal():
        raise argparse.ArgumentTypeError("threads must be an integer from 1 to 64")
    number = int(value)
    if not 1 <= number <= 64:
        raise argparse.ArgumentTypeError("threads must be an integer from 1 to 64")
    return number

def project_path(value: str | Path, error_code: str = "input_invalid") -> Path:
    path = Path(value)
    unresolved = path if path.is_absolute() else PROJECT_ROOT / path
    try:
        if unresolved.is_symlink() or (hasattr(unresolved, "is_junction") and unresolved.is_junction()):
            raise WorkerError(error_code)
        return unresolved.resolve()
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError(error_code) from exc

def fail_input():
    raise WorkerError("input_invalid")

def load_audio(path: Path):
    try:
        import numpy as np
        import soundfile as sf
    except Exception as exc:
        raise WorkerError("backend_unavailable") from exc
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 50 * 1024 * 1024:
            fail_input()
        info = sf.info(str(path))
        if (info.channels not in (1, 2) or not 8000 <= info.samplerate <= 192000 or
                info.frames <= 0 or info.frames / info.samplerate > 120):
            fail_input()
        samples, rate = sf.read(str(path), dtype="float32", always_2d=True)
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("input_invalid") from exc
    if (samples.ndim != 2 or samples.shape[0] <= 0 or samples.shape[1] not in (1, 2) or
            samples.shape[0] != info.frames or int(rate) != info.samplerate or
            not np.isfinite(samples).all() or not np.any(samples != 0)):
        fail_input()
    return np.asarray(samples, dtype=np.float32), int(rate), int(samples.shape[0]), int(samples.shape[1])

def validate_output_dir(path: Path) -> None:
    if (path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()) or
            (path.exists() and not path.is_dir())):
        raise WorkerError("output_failed")
    if path.exists():
        try:
            if any(path.iterdir()):
                raise WorkerError("output_failed")
        except WorkerError:
            raise
        except Exception as exc:
            raise WorkerError("output_failed") from exc

def validate_model(model_dir: Path) -> Path:
    weight = model_dir / WEIGHT_NAME
    if not model_dir.is_dir() or model_dir.is_symlink() or not weight.is_file() or weight.is_symlink():
        raise WorkerError("model_missing")
    try:
        digest = hashlib.sha256()
        with weight.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != WEIGHT_SHA256:
            raise WorkerError("model_integrity_failed")
        from safetensors import safe_open
        with safe_open(str(weight), framework="pt", device="cpu") as handle:
            metadata = handle.metadata() or {}
        if metadata.get("klass") != "demucs.htdemucs.HTDemucs" or "structure" in metadata:
            raise WorkerError("model_integrity_failed")
        import importlib.metadata
        if importlib.metadata.version("demucs") != "4.1.0":
            raise WorkerError("model_integrity_failed")
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("model_integrity_failed") from exc
    return weight

def run(args: argparse.Namespace) -> dict[str, Any]:
    audio_path = project_path(args.audio, "input_invalid")
    output_dir = project_path(args.output_dir, "output_failed")
    model_dir = project_path(args.model_dir, "model_missing")
    validate_output_dir(output_dir)
    samples, input_rate, input_frames, input_channels = load_audio(audio_path)
    weight = validate_model(model_dir)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import numpy as np
            import scipy.signal
            import torch
            from demucs.apply import apply_model
            from demucs.hf import load_safetensors_model
    except Exception as exc:
        raise WorkerError("backend_unavailable") from exc
    try:
        torch.set_num_threads(args.threads)
    except Exception as exc:
        raise WorkerError("backend_unavailable") from exc
    load_start = time.perf_counter()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            model = load_safetensors_model(str(weight))
            if (int(model.samplerate) != 44100 or int(model.audio_channels) != 2 or
                    tuple(model.sources) != LABELS):
                raise WorkerError("model_integrity_failed")
            model.to(device="cpu", dtype=torch.float32)
            model.eval()
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("model_load_failed") from exc
    load_ms = round((time.perf_counter() - load_start) * 1000)
    if input_channels == 1:
        samples = np.repeat(samples, 2, axis=1)
    if input_rate != 44100:
        divisor = math.gcd(input_rate, 44100)
        samples = scipy.signal.resample_poly(samples, 44100 // divisor, input_rate // divisor, axis=0).astype(np.float32)
    model_frames = int(samples.shape[0])
    if model_frames <= 0 or not np.isfinite(samples).all():
        raise WorkerError("inference_failed")
    reference = torch.from_numpy(samples.T.copy()).to(dtype=torch.float32)
    mono_reference = reference.mean(dim=0)
    mean = mono_reference.mean()
    std = mono_reference.std(unbiased=True)
    if not torch.isfinite(mean).all() or not torch.isfinite(std).all() or not bool((std > 0).all()):
        raise WorkerError("input_invalid")
    normalized = (reference - mean) / std
    infer_start = time.perf_counter()
    try:
        with torch.inference_mode():
            separated = apply_model(model, normalized[None], device="cpu", shifts=0, split=True,
                                    overlap=0.25, progress=False, num_workers=0)[0]
        if tuple(separated.shape) != (4, 2, model_frames) or not bool(torch.isfinite(separated).all()):
            raise WorkerError("inference_failed")
        separated = separated * std + mean
        vocals = separated[3].cpu().numpy().T.astype(np.float32, copy=False)
        accompaniment = separated[[0, 1, 2]].sum(dim=0).cpu().numpy().T.astype(np.float32, copy=False)
        if (not np.isfinite(vocals).all() or not np.isfinite(accompaniment).all() or
                vocals.size == 0 or accompaniment.size == 0):
            raise WorkerError("inference_failed")
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("inference_failed") from exc
    inference_ms = round((time.perf_counter() - infer_start) * 1000)
    analysis = scipy.signal.resample_poly(vocals.mean(axis=1), 160, 441, axis=0).astype(np.float32)
    arrays = (("vocals.wav", vocals, 44100, 2), ("accompaniment.wav", accompaniment, 44100, 2),
              ("vocals-analysis.wav", analysis[:, None], 16000, 1))
    if analysis.size == 0 or not np.isfinite(analysis).all():
        raise WorkerError("inference_failed")
    out_frames = {name: int(array.shape[0]) for name, array, _, _ in arrays}
    result = {
        "status": "ok", "schema_version": "vocal-0.1", "source_provider": "local",
        "source_model": "HTDemucs", "repository": REPOSITORY, "revision": REVISION,
        "weight_sha256": WEIGHT_SHA256, "demucs_version": "4.1.0", "torch_version": str(torch.__version__),
        "backend": {"requested": args.device, "actual": "cpu"}, "precision": "float32",
        "input": {"frames": input_frames, "sample_rate": input_rate, "channels": input_channels,
                  "duration_seconds": input_frames / input_rate},
        "model_input": {"frames": model_frames, "sample_rate": 44100,
                        "duration_seconds": model_frames / 44100},
        "outputs": [{"path": name, "frames": frames, "sample_rate": rate, "channels": channels,
                     "subtype": "FLOAT", "duration_seconds": frames / rate}
                    for (name, _, rate, channels), frames in zip(arrays, out_frames.values())],
        "coordinate_relation": "No intentional trim or speed change; resampling quantization may change frame count.",
        "load_ms": load_ms, "inference_ms": inference_ms, "quality": "owner_listening_pending",
        "timing": "none", "normalization": {"mean": float(mean.item()), "std": float(std.item())}, "shifts": 0,
    }
    if not math.isfinite(result["normalization"]["mean"]) or not math.isfinite(result["normalization"]["std"]):
        raise WorkerError("inference_failed")
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        if output_dir.is_symlink() or not output_dir.is_dir() or any(output_dir.iterdir()):
            raise WorkerError("output_failed")
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("output_failed") from exc
    created: list[Path] = []
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import soundfile as sf
            for (name, array, rate, _), _frames in zip(arrays, out_frames.values()):
                destination = output_dir / name
                if destination.resolve().parent != output_dir.resolve():
                    raise WorkerError("output_failed")
                with destination.open("xb") as stream:
                    created.append(destination)
                    sf.write(stream, array, rate, format="WAV", subtype="FLOAT")
        manifest_path = output_dir / "separation.json"
        with manifest_path.open("x", encoding="utf-8") as stream:
            created.append(manifest_path)
            stream.write(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    except Exception as exc:
        for path in created:
            try:
                path.unlink()
            except OSError:
                pass
        if isinstance(exc, WorkerError):
            raise
        raise WorkerError("output_failed") from exc
    return result

def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Run pinned local HTDemucs vocal separation.")
    ap.add_argument("--audio", required=True, help="Local soundfile-readable audio")
    ap.add_argument("--output-dir", required=True, help="New or empty local output directory")
    ap.add_argument("--model-dir", default=str(MODEL_DEFAULT), help="Pinned local HTDemucs model directory")
    ap.add_argument("--device", choices=("cpu",), default="cpu")
    ap.add_argument("--threads", type=positive_threads, default=6)
    return ap

def main() -> int:
    stdout = sys.stdout
    if hasattr(stdout, "reconfigure"):
        stdout.reconfigure(encoding="utf-8")
    args = parser().parse_args()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = run(args)
    except WorkerError as exc:
        result = {"status": exc.code, "error": {"code": exc.code, "message": exc.message}}
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), file=stdout)
        return 1
    except Exception:
        exc = WorkerError("inference_failed")
        result = {"status": exc.code, "error": {"code": exc.code, "message": exc.message}}
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), file=stdout)
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False), file=stdout)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
