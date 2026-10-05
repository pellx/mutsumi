"""Public search, YouTube captions, and configured AstrBot knowledge retrieval."""

from __future__ import annotations

import asyncio
import ipaddress
import json
from importlib import metadata
import math
import re
from collections.abc import Awaitable, Callable
from urllib.parse import parse_qsl, urlsplit

from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register


_SEARCH_LOCK = asyncio.Lock()
_VIDEO_LOCK = asyncio.Lock()
_KNOWLEDGE_LOCK = asyncio.Lock()
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_CAPTION_LANGUAGES = ("zh-Hans", "zh-Hant", "zh", "en")
_MAX_CAPTION_BYTES = 512 * 1024
_BACKGROUND_TASKS: set[asyncio.Task] = set()


def _package_matches(distribution: str, expected: str) -> bool:
    try:
        return metadata.version(distribution) == expected
    except Exception:
        return False


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _valid_query(query: object) -> bool:
    return isinstance(query, str) and bool(query.strip()) and len(query) <= 200


def _clean_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(ch for ch in value if ch >= " " and ch != "").strip()[:limit]


def _search_result(status: str, results: list[dict[str, str]]) -> str:
    payload: dict[str, object] = {
        "status": status,
        "provider": "DDGS",
        "backend": "Yahoo",
        "results": results,
        "data_is_untrusted": True,
    }
    rendered = _json(payload)
    while len(rendered) > 6000 and results:
        last = results[-1]
        if last["snippet"]:
            last["snippet"] = last["snippet"][:-64]
        elif last["title"]:
            last["title"] = last["title"][:-32]
        else:
            results.pop()
        rendered = _json(payload)
    return rendered


def _public_http_url(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 1000:
        return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme.lower() not in ("http", "https") or not host:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        if "." not in host or host == "localhost" or host.endswith(
            (".localhost", ".local", ".internal", ".test", ".invalid")
        ):
            return None
        if any(ord(ch) < 33 for ch in value):
            return None
        return value
    except (ValueError, UnicodeError):
        return None


def _canonical_youtube_url(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 300:
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.username is not None or parsed.password is not None:
            return None
        if parsed.port is not None or parsed.fragment:
            return None
        if parsed.netloc == "www.youtube.com" and parsed.path == "/watch":
            pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
            if len(pairs) != 1 or pairs[0][0] != "v":
                return None
            video_id = pairs[0][1]
        elif parsed.netloc == "youtu.be" and not parsed.query and parsed.path.count("/") == 1:
            video_id = parsed.path[1:]
        else:
            return None
        if not _VIDEO_ID.fullmatch(video_id):
            return None
        return f"https://www.youtube.com/watch?v={video_id}"
    except (ValueError, UnicodeError):
        return None


def _retain_task(task: asyncio.Task) -> None:
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


def _release_after_completion(lock: asyncio.Lock, task: asyncio.Task) -> None:
    async def wait_and_release() -> None:
        try:
            await task
        except BaseException:
            pass
        finally:
            lock.release()

    cleanup = asyncio.create_task(wait_and_release())
    _retain_task(cleanup)


async def _serialized(
    lock: asyncio.Lock,
    operation: Callable[[], Awaitable[object]],
    timeout: float,
) -> object:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max(0.0, timeout)
    await asyncio.wait_for(lock.acquire(), timeout=max(0.0, deadline - loop.time()))
    remaining = deadline - loop.time()
    if remaining <= 0:
        lock.release()
        raise TimeoutError

    try:
        task = asyncio.create_task(operation())
    except BaseException:
        lock.release()
        raise
    _retain_task(task)
    try:
        done, _ = await asyncio.wait({task}, timeout=max(0.0, deadline - loop.time()))
    except BaseException:
        _release_after_completion(lock, task)
        raise
    if not done:
        _release_after_completion(lock, task)
        raise TimeoutError
    try:
        return task.result()
    finally:
        lock.release()


def _unavailable_video(source_url: str, reason: str = "unavailable") -> str:
    return _json(
        {
            "status": "unavailable",
            "reason": reason,
            "capability": "captions_only",
            "visual_understanding": "unavailable",
            "audio_understanding": "unavailable",
            "source_url": source_url,
            "title": "",
            "language": None,
            "caption_source": None,
            "text": "",
            "truncated": False,
            "data_is_untrusted": True,
        }
    )


class _NullLogger:
    def debug(self, message: str, *args: object, **kwargs: object) -> None:
        return None

    def warning(self, message: str, *args: object, **kwargs: object) -> None:
        return None

    def error(self, message: str, *args: object, **kwargs: object) -> None:
        return None


def _extract_video_info(canonical_url: str) -> dict[str, object]:
    from yt_dlp import YoutubeDL

    options = {
        "quiet": True,
        "no_warnings": True,
        "logger": _NullLogger(),
        "noplaylist": True,
        "playlistend": 1,
        "skip_download": True,
        "socket_timeout": 8,
        "retries": 0,
        "extractor_retries": 0,
        "fragment_retries": 0,
        "cachedir": False,
        "ignoreconfig": True,
        "writesubtitles": False,
        "writeautomaticsub": False,
    }
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(canonical_url, download=False)
    if not isinstance(info, dict) or info.get("_type") == "playlist" or info.get("entries"):
        raise ValueError("unsupported")
    return info


def _select_caption_track(info: dict[str, object]) -> tuple[dict[str, object], str, str] | None:
    for caption_source, key in (("authored", "subtitles"), ("automatic", "automatic_captions")):
        tracks = info.get(key)
        if not isinstance(tracks, dict):
            continue
        for language in _CAPTION_LANGUAGES:
            variants = tracks.get(language)
            if not isinstance(variants, list):
                continue
            for variant in variants:
                if isinstance(variant, dict) and variant.get("ext") == "json3" and isinstance(variant.get("url"), str):
                    return variant, language, caption_source
    return None


def _caption_url_is_allowed(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (
            parsed.scheme == "https"
            and parsed.hostname in ("youtube.com", "www.youtube.com")
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
            and parsed.path == "/api/timedtext"
        )
    except (ValueError, UnicodeError):
        return False


async def _fetch_json3_caption(url: str) -> str:
    import httpx

    if not _caption_url_is_allowed(url):
        raise ValueError("unsupported")
    chunks: list[bytes] = []
    byte_count = 0
    async with httpx.AsyncClient(trust_env=False, timeout=10, follow_redirects=False) as client:
        async with client.stream("GET", url) as response:
            if response.status_code != 200 or response.is_redirect:
                raise ValueError("unavailable")
            async for chunk in response.aiter_bytes():
                byte_count += len(chunk)
                if byte_count > _MAX_CAPTION_BYTES:
                    raise ValueError("too_large")
                chunks.append(chunk)
    document = json.loads(b"".join(chunks))
    events = document.get("events") if isinstance(document, dict) else None
    if not isinstance(events, list):
        raise ValueError("malformed")
    pieces: list[str] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        segments = event.get("segs")
        if not isinstance(segments, list):
            continue
        for segment in segments:
            if isinstance(segment, dict) and isinstance(segment.get("utf8"), str):
                pieces.append(segment["utf8"])
    text = "".join(pieces).strip()
    if not text:
        raise ValueError("empty")
    return text


def _project_knowledge_results(value: object) -> list[dict[str, object]] | None:
    if not isinstance(value, dict) or "results" not in value:
        return None
    raw_results = value.get("results")
    if not isinstance(raw_results, list) or len(raw_results) > 3:
        return None
    projected: list[dict[str, object]] = []
    for result in raw_results:
        if not isinstance(result, dict):
            return None
        item: dict[str, object] = {}
        for output_name, input_name in (("chunk_id", "chunk_id"), ("doc_id", "doc_id"), ("kb_id", "kb_id"), ("kb_name", "kb_name")):
            raw_id = result.get(input_name)
            if not isinstance(raw_id, str) or not raw_id or len(raw_id) > 200:
                return None
            clean_id = _clean_text(raw_id, 200)
            if not clean_id or clean_id != raw_id:
                return None
            item[output_name] = clean_id
        for output_name, input_name, limit in (("title", "doc_name", 200), ("text", "content", 1200)):
            raw_text = result.get(input_name)
            if not isinstance(raw_text, str) or not raw_text:
                return None
            clean_text = _clean_text(raw_text, limit)
            if not clean_text:
                return None
            item[output_name] = clean_text
        score = result.get("score")
        if score is not None:
            if not isinstance(score, (int, float)) or isinstance(score, bool) or not math.isfinite(float(score)):
                return None
            item["retrieval_score"] = float(score)
            item["score_kind"] = "native_rank_fusion"
        projected.append(item)
    return projected


def _knowledge_json(status: str, results: list[dict[str, object]]) -> str:
    payload = {"status": status, "results": results, "data_is_untrusted": True}
    rendered = _json(payload)
    while len(rendered) > 6000 and results:
        last = results[-1]
        text = last.get("text")
        if isinstance(text, str) and text:
            last["text"] = text[:-100]
        else:
            results.pop()
        rendered = _json(payload)
    if not results and status == "ok":
        payload["status"] = "unavailable"
        rendered = _json(payload)
    return rendered


@register(
    "mutsumi_public_tools",
    "mutsumi",
    "Public web search, YouTube captions, and configured knowledge retrieval.",
    "0.1.0",
)
class MutsumiPublicTools(Star):
    """Tools for bounded public search, captions, and selected local knowledge bases."""

    def __init__(self, context: Context, config: dict | None = None) -> None:
        super().__init__(context, config)

    @filter.llm_tool(name="mutsumi_web_search")
    async def web_search(self, event: AstrMessageEvent, query: str) -> str:
        """Search public web pages with Yahoo through DDGS.

        Args:
            query(string): A short public search query, up to 200 codepoints.
        """
        if not _package_matches("astrbot", "4.28.2") or not _package_matches("ddgs", "9.16.0"):
            return _search_result("unavailable", [])
        if not _valid_query(query):
            return _search_result("unavailable", [])
        try:
            async def search() -> object:
                from ddgs import DDGS
                from ddgs.engines import ENGINES

                text_engines = ENGINES.get("text")
                if not isinstance(text_engines, dict) or "yahoo" not in text_engines:
                    raise RuntimeError("Yahoo text backend unavailable")

                return await asyncio.to_thread(
                    lambda: DDGS(timeout=8).text(
                        query, max_results=3, backend="yahoo", region="cn-zh", safesearch="moderate"
                    )
                )

            raw_results = await _serialized(_SEARCH_LOCK, search, 20)
            if not isinstance(raw_results, list):
                return _search_result("unavailable", [])
            results: list[dict[str, str]] = []
            for item in raw_results[:3]:
                if not isinstance(item, dict):
                    continue
                url = _public_http_url(item.get("href") or item.get("url"))
                if url is not None:
                    results.append(
                        {
                            "title": _clean_text(item.get("title"), 200),
                            "url": url,
                            "snippet": _clean_text(item.get("body") or item.get("snippet"), 800),
                        }
                    )
            return _search_result("ok" if results else "empty", results)
        except Exception:
            return _search_result("unavailable", [])

    @filter.llm_tool(name="mutsumi_video_captions")
    async def video_captions(self, event: AstrMessageEvent, url: str) -> str:
        """Fetch authored or automatic YouTube captions without downloading media.

        Args:
            url(string): A canonical YouTube watch URL or youtu.be URL.
        """
        if not _package_matches("astrbot", "4.28.2") or not _package_matches("yt-dlp", "2026.8.19"):
            return _unavailable_video("")
        canonical_url = _canonical_youtube_url(url)
        if canonical_url is None:
            return _unavailable_video("")
        try:
            async def extract() -> object:
                return await asyncio.to_thread(_extract_video_info, canonical_url)

            raw_info = await _serialized(_VIDEO_LOCK, extract, 30)
            if not isinstance(raw_info, dict):
                return _unavailable_video(canonical_url)
            duration = raw_info.get("duration")
            if isinstance(duration, bool) or not isinstance(duration, (int, float)):
                return _unavailable_video(canonical_url)
            if not math.isfinite(float(duration)) or duration < 0 or duration > 900:
                return _unavailable_video(canonical_url)
            track = _select_caption_track(raw_info)
            title = _clean_text(raw_info.get("title"), 200)
            if track is None:
                return _json(
                    {
                        "status": "unavailable",
                        "reason": "captions_unavailable",
                        "capability": "captions_only",
                        "visual_understanding": "unavailable",
                        "audio_understanding": "unavailable",
                        "source_url": canonical_url,
                        "title": title,
                        "language": None,
                        "caption_source": None,
                        "text": "",
                        "truncated": False,
                        "data_is_untrusted": True,
                    }
                )
            caption_track, language, caption_source = track
            caption_url = caption_track["url"]
            async def fetch() -> object:
                return await _fetch_json3_caption(caption_url)

            transcript = await _serialized(_VIDEO_LOCK, fetch, 12)
            if not isinstance(transcript, str):
                return _unavailable_video(canonical_url)
            bounded_text = transcript[:8000]
            return _json(
                {
                    "status": "ok",
                    "capability": "captions_only",
                    "visual_understanding": "unavailable",
                    "audio_understanding": "unavailable",
                    "source_url": canonical_url,
                    "title": title,
                    "language": language,
                    "caption_source": caption_source,
                    "text": bounded_text,
                    "truncated": len(transcript) > len(bounded_text),
                    "data_is_untrusted": True,
                }
            )
        except Exception:
            return _unavailable_video(canonical_url)

    @filter.llm_tool(name="mutsumi_knowledge_search")
    async def knowledge_search(self, event: AstrMessageEvent, query: str) -> str:
        """Search only the knowledge bases selected in AstrBot configuration.

        Args:
            query(string): A concise knowledge query, up to 200 codepoints.
        """
        if not _package_matches("astrbot", "4.28.2"):
            return _knowledge_json("unavailable", [])
        if not _valid_query(query):
            return _knowledge_json("unavailable", [])
        try:
            config = self.context.get_config(umo=event.unified_msg_origin)
            names = config.get("kb_names") if isinstance(config, dict) else None
            if not isinstance(names, list) or not names or len(names) > 3:
                return _knowledge_json("unavailable", [])
            if any(not isinstance(name, str) or not name or name != name.strip() or len(name) > 200 for name in names):
                return _knowledge_json("unavailable", [])
            selected_names = list(dict.fromkeys(names))
            if not selected_names:
                return _knowledge_json("unavailable", [])
            async def retrieve() -> object:
                manager = self.context.kb_manager
                for name in selected_names:
                    helper = await manager.get_kb_by_name(name)
                    if helper is None or getattr(helper, "init_error", None):
                        return {}
                return await manager.retrieve(
                    query=query,
                    kb_names=selected_names,
                    top_k_fusion=6,
                    top_m_final=3,
                )

            raw = await _serialized(_KNOWLEDGE_LOCK, retrieve, 30)
            if isinstance(raw, dict) and not raw:
                return _knowledge_json("unavailable", [])
            if raw is None:
                return _knowledge_json("empty", [])
            results = _project_knowledge_results(raw)
            if results is None:
                return _knowledge_json("unavailable", [])
            return _knowledge_json("ok" if results else "empty", results)
        except Exception:
            return _knowledge_json("unavailable", [])
