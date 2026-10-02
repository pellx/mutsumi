from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

from align import MODEL_DEFAULT, MODEL_FILES, PROJECT_ROOT, SOURCE, WorkerError, load_audio, project_path, raw_units
from onset_result import map_character_onsets

RATE = 16000
MAX_JSON = 2 * 1024 * 1024
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}')


def _fail(code: str, message: str):
    raise WorkerError(code, message)


def validate_sentences(payload: Any, sample_rate: int, clip_frames: int) -> tuple[str, list[dict[str, Any]]]:
    if type(payload) is not dict or payload.get('schema_version') != 'auto-sentence-0.1':
        _fail('input_invalid', 'Sentence file must use auto-sentence-0.1.')
    transcript = payload.get('transcript')
    if type(transcript) is not str or not transcript.strip() or len(transcript) > 6000:
        _fail('input_invalid', 'Sentence file transcript is invalid.')
    if (type(payload.get('sample_rate')) is not int or type(payload.get('clip_frames')) is not int
            or payload['sample_rate'] != sample_rate or payload['clip_frames'] != clip_frames):
        _fail('input_invalid', 'Sentence file audio metadata does not match the WAV.')
    sentences = payload.get('sentences')
    if type(sentences) is not list or not 1 <= len(sentences) <= 100:
        _fail('input_invalid', 'Sentence list must contain 1 to 100 entries.')
    cursor = 0
    ids = set()
    validated = []
    for item in sentences:
        if type(item) is not dict:
            _fail('input_invalid', 'Sentence entry is invalid.')
        sid, text = item.get('sentence_id'), item.get('text')
        if type(sid) is not str or not _ID.fullmatch(sid) or sid in ids:
            _fail('input_invalid', 'Sentence identifiers must be unique safe strings.')
        ids.add(sid)
        if type(text) is not str or not text:
            _fail('input_invalid', 'Sentence text is invalid.')
        ts, te = item.get('text_start'), item.get('text_end')
        if type(ts) is not int or type(te) is not int or ts != cursor or te <= ts or te > len(transcript):
            _fail('input_invalid', 'Sentence text offsets must be contiguous Python string offsets.')
        if transcript[ts:te] != text:
            _fail('input_invalid', 'Sentence text does not match transcript offsets.')
        cursor = te
        status = item.get('status')
        if status == 'candidate':
            start, end = item.get('start_sample'), item.get('end_sample')
            start_ms, end_ms = item.get('start_ms'), item.get('end_ms')
            if (type(start) is not int or type(end) is not int or not 0 <= start < end <= clip_frames
                    or type(start_ms) is not int or type(end_ms) is not int
                    or start_ms != round(start * 1000 / sample_rate)
                    or end_ms != round(end * 1000 / sample_rate)):
                _fail('input_invalid', 'Candidate sample and millisecond bounds are invalid.')
        elif status not in ('unavailable', 'skipped'):
            _fail('input_invalid', 'Sentence status is invalid.')
        validated.append(item)
    if cursor != len(transcript):
        _fail('input_invalid', 'Sentence entries must cover the complete transcript.')
    prior_end = -1
    for item in validated:
        if item.get('status') == 'candidate':
            if item['start_sample'] < prior_end:
                _fail('input_invalid', 'Candidate sentence bounds must not overlap.')
            prior_end = item['end_sample']
    return transcript, validated


def build_views(result: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int | None]:
    units = result['units']
    lexical = [u for u in units if u.get('granularity') in ('character', 'word') and isinstance(u.get('text'), str)]
    raw_units = result.get('raw_units')
    raw_starts = []
    if type(raw_units) is list and len(raw_units) == len(units):
        raw_starts = [u.get('start_time') if type(u) is dict else None for u in raw_units]
    reasons_valid = all(u.get('reason') not in ('invalid_start_time', 'non_monotonic_onset', 'rounded_outside_sentence')
                        for u in lexical)
    native_valid = (len(raw_starts) == len(units)
                    and all(type(raw_starts[u['index']]) in (int, float)
                            and math.isfinite(raw_starts[u['index']])
                            and 0 <= raw_starts[u['index']] <
                                (result['sentence_end_ms'] - result['sentence_start_ms']) / 1000
                            and result['sentence_start_ms'] <= u.get('onset_ms', -1) < result['sentence_end_ms']
                            for u in lexical)
                    and all(raw_starts[b['index']] >= raw_starts[a['index']]
                            for a, b in zip(lexical, lexical[1:])))
    valid = (result.get('lexical_coverage') == 'complete' and bool(lexical) and reasons_valid and native_valid
             and all(type(u.get('onset_ms')) is int for u in lexical))
    markers = []
    if valid:
        groups = {}
        for unit in lexical:
            groups.setdefault(unit['onset_ms'], []).append(unit)
        for onset, group in sorted(groups.items()):
            granularities = {u['granularity'] for u in group}
            markers.append({'onset_ms': onset, 'unit_indices': [u['index'] for u in group],
                            'texts': [u['text'] for u in group],
                            'granularities': [u['granularity'] for u in group],
                            'ambiguity': 'insufficient_character_granularity' if 'word' in granularities else ('indistinguishable_onset' if len(group) > 1 else None)})
    cells = []
    if valid:
        for i, marker in enumerate(markers):
            end = markers[i + 1]['onset_ms'] if i + 1 < len(markers) else result['sentence_end_ms']
            if end > marker['onset_ms']:
                cells.append({'boundary_start_ms': marker['onset_ms'], 'boundary_end_ms': end,
                              'occupancy_ms': end - marker['onset_ms'], 'unit_indices': marker['unit_indices'],
                              'kind': 'adjacent_onset_occupancy', 'quality': marker['ambiguity'] or 'distinct_onset'})
    prefix = max(0, markers[0]['onset_ms'] - result['sentence_start_ms']) if markers else None
    return markers, cells, prefix


def _read_input(path: Path, rate: int, frames: int):
    try:
        if path.stat().st_size > MAX_JSON:
            _fail('input_invalid', 'Sentence JSON exceeds 2 MiB.')
        payload = json.loads(path.read_text(encoding='utf-8-sig'))
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError('input_invalid', 'Sentence JSON must be readable UTF-8 JSON.') from exc
    return validate_sentences(payload, rate, frames)


def run(args):
    audio_path, sentence_path, output_dir, model_dir = (project_path(v) for v in (args.audio, args.sentences_file, args.output_dir, args.model_dir))
    samples, rate, duration = load_audio(audio_path)
    frames = len(samples)
    transcript, sentences = _read_input(sentence_path, rate, frames)
    target = output_dir / 'character-starts.json'
    if output_dir.exists() and (not output_dir.is_dir() or any(output_dir.iterdir())):
        _fail('input_invalid', 'Output directory must be new or empty.')
    if not model_dir.is_dir() or any(not (model_dir / name).is_file() for name in MODEL_FILES):
        _fail('model_missing', 'The configured local model directory is incomplete.')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import numpy as np
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        torch.set_num_threads(args.threads)
        load_start = time.perf_counter()
        try:
            from qwen_asr import Qwen3ForcedAligner
            aligner = Qwen3ForcedAligner.from_pretrained(str(model_dir), device_map='cpu', dtype=torch.float32,
                attn_implementation='eager', local_files_only=True, trust_remote_code=False, use_safetensors=True)
        except Exception as exc:
            raise WorkerError('model_load_failed', 'The local aligner could not be loaded.') from exc
        load_ms = round((time.perf_counter() - load_start) * 1000)
        records = []
        for sentence in sentences:
            original = dict(sentence)
            record = {'sentence': original, 'onset_result': None, 'markers': [], 'occupancy_cells': [],
                      'prefix_unassigned_ms': None, 'inference_ms': None}
            if sentence.get('status') != 'candidate':
                record['onset_result'] = {'status': 'unavailable', 'reason': sentence.get('reason') or 'sentence_not_candidate'}
                records.append(record)
                continue
            start, end = sentence['start_sample'], sentence['end_sample']
            started = time.perf_counter()
            try:
                result = aligner.align(audio=(samples[start:end], rate), text=sentence['text'], language='Chinese')
                native = raw_units(result[0].items)
                mapped = map_character_onsets(native, transcript=sentence['text'], sentence_id=sentence['sentence_id'],
                    crop_start_sample=start, crop_frames=end-start, sample_rate=rate, clip_frames=frames, source=SOURCE)
                record['inference_ms'] = round((time.perf_counter() - started) * 1000)
                record['onset_result'] = mapped
                markers, cells, prefix = build_views(mapped)
                record.update(markers=markers, occupancy_cells=cells, prefix_unassigned_ms=prefix)
            except Exception:
                record['inference_ms'] = round((time.perf_counter() - started) * 1000)
                record['onset_result'] = {'status': 'unavailable', 'reason': 'inference_failed'}
            records.append(record)
    status = 'ok' if all(x['onset_result'] and x['onset_result'].get('status') == 'candidate' for x in records) else 'partial'
    output = {'schema_version': 'character-starts-0.1', 'status': status, 'transcript': transcript,
              'sample_rate': rate, 'clip_frames': frames, 'duration_ms': round(duration * 1000),
              'source': SOURCE, 'backend': 'cpu', 'load_ms': load_ms, 'quality': 'onset_listening_pending',
              'sentences': records}
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        with target.open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(output, stream, ensure_ascii=True, separators=(',', ':'), allow_nan=False)
            stream.write('\n')
    except Exception as exc:
        raise WorkerError('output_failed', 'Could not exclusively write character onset output.') from exc
    return output


def parser():
    ap = argparse.ArgumentParser(description='Create conservative character onset candidates from sentence crops.')
    ap.add_argument('--audio', required=True)
    ap.add_argument('--sentences-file', required=True)
    ap.add_argument('--output-dir', required=True)
    ap.add_argument('--model-dir', default=str(MODEL_DEFAULT))
    ap.add_argument('--threads', type=int, choices=range(1, 25), default=6)
    return ap


def main():
    out = sys.stdout
    if hasattr(out, 'reconfigure'):
        out.reconfigure(encoding='utf-8')
    args = parser().parse_args()
    try:
        value = run(args)
        code = 0
    except WorkerError as exc:
        value = {'status': exc.code, 'error': {'code': exc.code, 'message': exc.message}}
        code = 1
    except Exception:
        value = {'status': 'inference_failed', 'error': {'code': 'inference_failed', 'message': 'Local onset processing failed.'}}
        code = 1
    print(json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False), file=out)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
