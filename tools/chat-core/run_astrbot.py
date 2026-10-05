#!/usr/bin/env python3
"""Pinned AstrBot bootstrap and one-attempt OpenAI compatible adapter."""
from __future__ import annotations
import argparse, asyncio, importlib.metadata, inspect, json, os, sys
from pathlib import Path
from typing import Any
PINNED_VERSION = "4.28.2"
PROVIDER_TYPE = "mutsumi_openai_once"
MODEL = "gemini-3.8-flash"
API_BASE = "https://api.ohmygpt.com/v1"
MAX_CONFIG_BYTES = 1024 * 1024
class BootstrapError(Exception): pass

def obj(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict): raise BootstrapError(f"invalid_{name}")
    return value

def read_config(root: Path) -> dict[str, Any]:
    try:
        with (root / "data" / "cmd_config.json").open("rb") as f: raw = f.read(MAX_CONFIG_BYTES + 1)
    except OSError as exc: raise BootstrapError("config_unavailable") from exc
    if len(raw) > MAX_CONFIG_BYTES: raise BootstrapError("config_too_large")
    try: return obj(json.loads(raw), "root")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc: raise BootstrapError("config_invalid_json") from exc

def validate(c: dict[str, Any]) -> None:
    d = obj(c.get("dashboard"), "dashboard")
    if d.get("host") != "127.0.0.1": raise BootstrapError("dashboard_must_be_loopback")
    p = d.get("port")
    if isinstance(p, bool) or not isinstance(p, int) or not 1 <= p <= 65535: raise BootstrapError("dashboard_port_invalid")
    if d.get("enable") is not True: raise BootstrapError("dashboard_must_be_enabled")
    for k in ("password", "pbkdf2_password"):
        v = d.get(k)
        if v is not None and (not isinstance(v, str) or bool(v.strip())): raise BootstrapError("dashboard_password_not_allowed")
    if c.get("platform", []) != []: raise BootstrapError("platforms_not_allowed")
    a = obj(c.get("agent_runner"), "agent_runner")
    m = obj(a.get("model"), "agent_model")
    if not isinstance(m.get("provider_id"), str) or not m["provider_id"].strip(): raise BootstrapError("agent_provider_required")
    if a.get("fallback_provider_ids") != []: raise BootstrapError("agent_fallbacks_not_allowed")
    r = a.get("request_max_retries")
    if isinstance(r, bool) or r != 1: raise BootstrapError("agent_retry_count_invalid")
    if obj(a.get("compression"), "compression").get("overflow_strategy") != "truncate_by_turns": raise BootstrapError("compression_strategy_invalid")
    ps = c.get("provider")
    if not isinstance(ps, list) or len(ps) != 1: raise BootstrapError("provider_selection_invalid")
    x = obj(ps[0], "provider")
    if x.get("enable") is not True or x.get("type") != PROVIDER_TYPE: raise BootstrapError("provider_selection_invalid")
    q = obj(x.get("config"), "provider_config")
    if q.get("model") != MODEL or q.get("api_base") != API_BASE: raise BootstrapError("provider_settings_invalid")
    keys = q.get("key")
    if not isinstance(keys, list) or not keys or any(not isinstance(k, str) or not k.strip() for k in keys): raise BootstrapError("provider_key_missing")

def runtime_root(arg: str) -> Path:
    p = Path(arg)
    if not p.is_absolute(): raise BootstrapError("runtime_root_must_be_absolute")
    try: p = p.resolve(strict=True)
    except OSError as exc: raise BootstrapError("runtime_root_unavailable") from exc
    if not p.is_dir() or not (p / ".astrbot").is_dir() or not (p / "data" / "cmd_config.json").is_file(): raise BootstrapError("runtime_root_not_initialized")
    return p

def verify_version() -> None:
    try: v = importlib.metadata.version("astrbot")
    except importlib.metadata.PackageNotFoundError as exc: raise BootstrapError("astrbot_not_installed") from exc
    if v != PINNED_VERSION: raise BootstrapError("astrbot_version_mismatch")

def register_adapter() -> None:
    from astrbot.core.provider.register import register_provider_adapter
    from astrbot.core.provider.provider import ProviderType
    from astrbot.core.provider.sources.openai_source import ProviderOpenAIOfficial
    @register_provider_adapter(PROVIDER_TYPE, "Mutsumi OpenAI compatible one-attempt provider", provider_type=ProviderType.CHAT_COMPLETION, provider_display_name="Mutsumi OpenAI One Attempt")
    class MutsumiOpenAIOneAttempt(ProviderOpenAIOfficial):
        def __init__(self, provider_config: Any, provider_settings: Any):
            super().__init__(provider_config, provider_settings)
            client = getattr(self, "client", None)
            if client is None or not hasattr(client, "max_retries"): raise BootstrapError("provider_client_incompatible")
            client.max_retries = 0
        async def text_chat(self, *args: Any, request_max_retries: int | None = None, **kwargs: Any) -> Any:
            return await super().text_chat(*args, request_max_retries=1, **kwargs)
        async def text_chat_stream(self, *args: Any, request_max_retries: int | None = None, **kwargs: Any):
            async for part in super().text_chat_stream(*args, request_max_retries=1, **kwargs): yield part
        async def _handle_api_error(self, e: Exception, payloads: Any, context_query: Any, func_tool: Any, chosen_key: Any, available_api_keys: Any, retry_cnt: Any, max_retries: Any, image_fallback_used: bool = False) -> None:
            raise e
    for n in ("text_chat", "text_chat_stream", "_handle_api_error"):
        if not callable(getattr(MutsumiOpenAIOneAttempt, n, None)): raise BootstrapError("provider_adapter_incompatible")

async def serve(root: Path) -> None:
    from filelock import FileLock, Timeout
    lock = FileLock(str(root / ".astrbot" / "astrbot.lock"))
    try: lock.acquire(timeout=0)
    except Timeout as exc: raise BootstrapError("runtime_already_running") from exc
    try:
        register_adapter()
        try:
            from astrbot.core import db_helper, log_broker
            from astrbot.core.initial_loader import InitialLoader
        except ImportError as exc: raise BootstrapError("astrbot_api_incompatible") from exc
        loader = InitialLoader(db_helper, log_broker)
        start = getattr(loader, "start", None)
        if not callable(start): raise BootstrapError("astrbot_loader_incompatible")
        result = start()
        if not inspect.isawaitable(result): raise BootstrapError("astrbot_loader_incompatible")
        await result
        try: from astrbot.cli.utils.basic import check_dashboard
        except ImportError as exc: raise BootstrapError("astrbot_dashboard_incompatible") from exc
        check = check_dashboard(str(root / "data"))
        if inspect.isawaitable(check): await check
        await asyncio.Event().wait()
    finally: lock.release()

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", required=True, help="absolute initialized AstrBot runtime path")
    parser.add_argument("--check", action="store_true", help="validate setup without starting AstrBot")
    args = parser.parse_args(argv)
    try:
        root = runtime_root(args.runtime_root)
        validate(read_config(root))
        verify_version()
        if args.check:
            print(json.dumps({"astrbot_version": PINNED_VERSION, "dashboard_host": "127.0.0.1", "request_attempts": 1}, separators=(",", ":")))
            return 0
        os.environ["ASTRBOT_ROOT"] = str(root)
        os.environ["ASTRBOT_CLI"] = "1"
        os.chdir(root)
        asyncio.run(serve(root))
        return 0
    except BootstrapError as exc:
        print(f"bootstrap_error:{exc}", file=sys.stderr)
        return 2
    except (KeyboardInterrupt, asyncio.CancelledError): return 0
    except Exception:
        print("bootstrap_error:startup_failed", file=sys.stderr)
        return 2
if __name__ == "__main__": raise SystemExit(main())
