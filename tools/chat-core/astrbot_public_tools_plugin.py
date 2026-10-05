"""Public search, YouTube captions, and configured AstrBot knowledge retrieval."""

from __future__ import annotations

import asyncio
import ipaddress
import json
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
        "backend": "bing",
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


async def _serialized(
    lock: asyncio.Lock,
    operation: Callable[[], Awaitable[object]],
    timeout: float,
) -> object:
    await lock.acquire()
    task = asyncio.create_task(operation())
    try:
        done, _ = await asyncio.wait({task}, timeout=timeout)
        if not done:
            async def release_after_completion() -> None:
                try:
                    await task
                except BaseException:
                    pass
                finally:
                    lock.release()

            asyncio.create_task(release_after_completion())
            raise TimeoutError
        return task.result()
    except asyncio.CancelledError:
        async def release_after_cancellation() -> None:
            try:
                await task
            except BaseException:
                pass
            finally:
                lock.release()

        asyncio.create_task(release_after_cancellation())
        raise
    except BaseException:
        if task.done():
            lock.release()
        raise


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
    if raw_results is None:
        return []
    if not isinstance(raw_results, list):
        return None
    projected: list[dict[str, object]] = []
    for result in raw_results[:3]:
        if not isinstance(result, dict):
            return None
        fields = (
            ("chunk_id", "chunk_id", 200),
            ("doc_id", "doc_id", 200),
            ("kb_id", "kb_id", 200),
            ("kb_name", "kb_name", 200),
            ("title", "doc_name", 200),
            ("text", "content", 1200),
        )
        item: dict[str, object] = {}
        for output_name, input_name, limit in fields:
            raw = result.get(input_name)
            if not isinstance(raw, str) or not raw:
                return None
            item[output_name] = _clean_text(raw, limit)
        score = result.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(float(score)):
            item["semantic_similarity"] = float(score)
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
        """Search public web pages with Bing through DDGS.

        Args:
            query(string): A short public search query, up to 200 codepoints.
        """
        if not _valid_query(query):
            return _search_result("unavailable", [])
        try:
            async def search() -> object:
                from ddgs import DDGS

                return await asyncio.to_thread(
                    lambda: DDGS(timeout=8).text(
                        query, max_results=3, backend="bing", region="cn-zh", safesearch="moderate"
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
        if not _valid_query(query):
            return _knowledge_json("unavailable", [])
        try:
            config = self.context.get_config(umo=event.unified_msg_origin)
            names = config.get("kb_names") if isinstance(config, dict) else None
            if not isinstance(names, list) or not names:
                return _knowledge_json("unavailable", [])
            selected_names = list(dict.fromkeys(name for name in names if isinstance(name, str) and name.strip()))
            if not selected_names:
                return _knowledge_json("unavailable", [])

            async def retrieve() -> object:
                return await self.context.kb_manager.retrieve(
                    query=query,
                    kb_names=selected_names,
                    top_k_fusion=6,
                    top_m_final=3,
                )

            raw = await _serialized(_KNOWLEDGE_LOCK, retrieve, 30)
            if raw is None or raw == {}:
                return _knowledge_json("empty", [])
            results = _project_knowledge_results(raw)
            if results is None:
                return _knowledge_json("unavailable", [])
            return _knowledge_json("ok" if results else "empty", results)
        except Exception:
            return _knowledge_json("unavailable", [])