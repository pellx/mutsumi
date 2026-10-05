#!/usr/bin/env python3
"""Pinned AstrBot bootstrap and one-attempt provider."""
from __future__ import annotations
import argparse, asyncio, hashlib, importlib.metadata, inspect, json, os, sys
from pathlib import Path
from typing import Any
PINNED_VERSION="4.28.2"; PROVIDER_TYPE="mutsumi_openai_once"; MODEL="gemini-3.8-flash"; API_BASE="https://api.ohmygpt.com/v1"; MAX_CONFIG_BYTES=1024*1024
class BootstrapError(Exception): pass
def obj(v: Any,n: str)->dict[str,Any]:
    if not isinstance(v,dict): raise BootstrapError(f"invalid_{n}")
    return v
def read_config(root: Path)->dict[str,Any]:
    try:
        with (root/"data"/"cmd_config.json").open("rb") as f: raw=f.read(MAX_CONFIG_BYTES+1)
    except OSError as e: raise BootstrapError("config_unavailable") from e
    if len(raw)>MAX_CONFIG_BYTES: raise BootstrapError("config_too_large")
    try: return obj(json.loads(raw),"root")
    except (UnicodeDecodeError,json.JSONDecodeError) as e: raise BootstrapError("config_invalid_json") from e
def validate(c: dict[str,Any])->None:
    d=obj(c.get("dashboard"),"dashboard")
    if d.get("host")!="127.0.0.1": raise BootstrapError("dashboard_must_be_loopback")
    p=d.get("port")
    if isinstance(p,bool) or not isinstance(p,int) or not 1<=p<=65535: raise BootstrapError("dashboard_port_invalid")
    if d.get("enable") is not True: raise BootstrapError("dashboard_must_be_enabled")
    creds=[d.get(k) for k in ("password","pbkdf2_password")]
    if any(v is not None and not isinstance(v,str) for v in creds): raise BootstrapError("dashboard_credentials_invalid")
    good=[v for v in creds if isinstance(v,str) and v.strip()]
    if not good or any(v=="astrbot" or v.lower()==hashlib.md5(b"astrbot").hexdigest() for v in good): raise BootstrapError("dashboard_password_required")
    if c.get("platform")!=[]: raise BootstrapError("platforms_not_allowed")
    a=obj(c.get("agent_runner"),"agent_runner")
    if a.get("runner_type")!="local": raise BootstrapError("agent_runner_must_be_local")
    cfg=obj(a.get("config"),"agent_config"); m=obj(cfg.get("model"),"agent_model"); pid=m.get("provider_id")
    if not isinstance(pid,str) or not pid.strip(): raise BootstrapError("agent_provider_required")
    if m.get("fallback_provider_ids")!=[]: raise BootstrapError("agent_fallbacks_not_allowed")
    r=m.get("request_max_retries")
    if type(r) is not int or r!=1: raise BootstrapError("agent_retry_count_invalid")
    if obj(cfg.get("compression"),"compression").get("overflow_strategy")!="truncate_by_turns": raise BootstrapError("compression_strategy_invalid")
    if c.get("provider_sources",[])!=[]: raise BootstrapError("provider_sources_not_allowed")
    ps=c.get("provider")
    if not isinstance(ps,list) or not 1<=len(ps)<=2: raise BootstrapError("provider_selection_invalid")
    providers=[obj(item,"provider") for item in ps]
    ids=[item.get("id") for item in providers]
    if any(not isinstance(value,str) or not value.strip() for value in ids) or len(set(ids))!=len(ids): raise BootstrapError("provider_ids_invalid")
    chats=[item for item in providers if item.get("type")==PROVIDER_TYPE]
    embeddings=[item for item in providers if item.get("type")=="openai_embedding"]
    if len(chats)!=1 or len(embeddings)>1 or len(chats)+len(embeddings)!=len(providers): raise BootstrapError("provider_selection_invalid")
    x=chats[0]
    if x.get("enable") is not True: raise BootstrapError("provider_selection_invalid")
    if x.get("id")!=pid: raise BootstrapError("provider_id_mismatch")
    if x.get("model")!=MODEL or x.get("api_base")!=API_BASE: raise BootstrapError("provider_settings_invalid")
    keys=x.get("key")
    if not isinstance(keys,list) or len(keys)!=1 or not isinstance(keys[0],str) or not keys[0].strip(): raise BootstrapError("provider_key_missing")
    if embeddings:
        e=embeddings[0]
        if e.get("enable") is not True or e.get("id")==pid: raise BootstrapError("embedding_provider_invalid")
        if e.get("embedding_model")!="BAAI/bge-small-zh-v1.5" or type(e.get("embedding_dimensions")) is not int or e.get("embedding_dimensions")!=512 or e.get("embedding_dimensions_mode")!="never": raise BootstrapError("embedding_settings_invalid")
        base=e.get("embedding_api_base")
        import re
        match=re.fullmatch(r"http://127\.0\.0\.1:([0-9]+)/v1",base) if isinstance(base,str) else None
        if not match or not 1<=int(match.group(1))<=65535: raise BootstrapError("embedding_endpoint_invalid")
        api_key=e.get("embedding_api_key")
        if not isinstance(api_key,str) or len(api_key.strip())<24 or "\r" in api_key or "\n" in api_key: raise BootstrapError("embedding_key_invalid")
        timeout=e.get("timeout",20)
        if type(timeout) is not int or not 1<=timeout<=30: raise BootstrapError("embedding_timeout_invalid")
        if e.get("proxy","") not in (None,""): raise BootstrapError("embedding_proxy_not_allowed")
        for header_name in ("request_headers","custom_headers"):
            headers=e.get(header_name)
            if headers is not None and (not isinstance(headers,dict) or headers): raise BootstrapError("embedding_headers_not_allowed")
def runtime_root(arg: str)->Path:
    p=Path(arg)
    if not p.is_absolute(): raise BootstrapError("runtime_root_must_be_absolute")
    try: p=p.resolve(strict=True)
    except OSError as e: raise BootstrapError("runtime_root_unavailable") from e
    if not p.is_dir() or not (p/".astrbot").is_file() or not (p/"data"/"cmd_config.json").is_file(): raise BootstrapError("runtime_root_not_initialized")
    return p
def verify_version()->None:
    try: v=importlib.metadata.version("astrbot")
    except importlib.metadata.PackageNotFoundError as e: raise BootstrapError("astrbot_not_installed") from e
    if v!=PINNED_VERSION: raise BootstrapError("astrbot_version_mismatch")
def register_adapter()->None:
    try:
        from astrbot.core.provider.entities import ProviderType
        from astrbot.core.provider.register import register_provider_adapter
        from astrbot.core.provider.sources.openai_source import ProviderOpenAIOfficial
    except ImportError as e: raise BootstrapError("astrbot_api_incompatible") from e
    init=ProviderOpenAIOfficial.__init__; chat=ProviderOpenAIOfficial.text_chat; stream=ProviderOpenAIOfficial.text_chat_stream; convert=ProviderOpenAIOfficial._finally_convert_payload; err=ProviderOpenAIOfficial._handle_api_error
    if not inspect.isfunction(init) or len(inspect.signature(init).parameters)<3: raise BootstrapError("provider_api_incompatible")
    if not inspect.isfunction(convert) or list(inspect.signature(convert).parameters) != ["self", "payloads"]: raise BootstrapError("provider_api_incompatible")
    for fn,gen in ((chat,False),(stream,True)):
        if (gen and not inspect.isasyncgenfunction(fn)) or (not gen and not inspect.iscoroutinefunction(fn)): raise BootstrapError("provider_api_incompatible")
        q=inspect.signature(fn).parameters
        if "request_max_retries" not in q or not any(v.kind is inspect.Parameter.VAR_KEYWORD for v in q.values()): raise BootstrapError("provider_api_incompatible")
    if not inspect.iscoroutinefunction(err) or not {"e","payloads","context_query","func_tool","chosen_key","available_api_keys","retry_cnt","max_retries"}.issubset(inspect.signature(err).parameters): raise BootstrapError("provider_api_incompatible")
    @register_provider_adapter(PROVIDER_TYPE,"Mutsumi OpenAI compatible one-attempt provider",provider_type=ProviderType.CHAT_COMPLETION,provider_display_name="Mutsumi OpenAI One Attempt")
    class Once(ProviderOpenAIOfficial):
        def __init__(self,provider_config: Any,provider_settings: Any):
            super().__init__(provider_config,provider_settings); client=getattr(self,"client",None)
            if client is None or not hasattr(client,"max_retries"): raise BootstrapError("provider_client_incompatible")
            client.max_retries=0
        def _finally_convert_payload(self,payloads: dict[str,Any])->None:
            super()._finally_convert_payload(payloads)
            for message in payloads.get("messages",[]):
                content=message.get("content")
                if isinstance(content,list) and content and all(isinstance(part,dict) and set(part)=={"type","text"} and part.get("type")=="text" and isinstance(part.get("text"),str) for part in content):
                    message["content"]="\n\n".join(part["text"] for part in content)
        @staticmethod
        def bound(fn: Any,self: Any,args: tuple[Any,...],kwargs: dict[str,Any])->inspect.BoundArguments:
            try: b=inspect.signature(fn).bind_partial(self,*args,**kwargs)
            except TypeError as e: raise BootstrapError("provider_call_incompatible") from e
            model=b.arguments.get("model")
            if model is not None and model!=MODEL: raise BootstrapError("provider_model_override_rejected")
            b.arguments["request_max_retries"]=1; return b
        async def text_chat(self,*args: Any,**kwargs: Any)->Any:
            b=self.bound(chat,self,args,kwargs); return await chat(*b.args,**b.kwargs)
        async def text_chat_stream(self,*args: Any,**kwargs: Any):
            b=self.bound(stream,self,args,kwargs)
            async for part in stream(*b.args,**b.kwargs): yield part
        async def _handle_api_error(self,e: Exception,payloads: Any,context_query: Any,func_tool: Any,chosen_key: Any,available_api_keys: Any,retry_cnt: Any,max_retries: Any,image_fallback_used: bool=False)->None: raise e
    if not inspect.iscoroutinefunction(Once.text_chat) or not inspect.isasyncgenfunction(Once.text_chat_stream): raise BootstrapError("provider_adapter_incompatible")
async def serve(root: Path)->None:
    try: from filelock import FileLock,Timeout
    except ImportError as e: raise BootstrapError("runtime_lock_unavailable") from e
    lock=FileLock(str(root/"astrbot.lock"))
    try: lock.acquire(timeout=0)
    except Timeout as e: raise BootstrapError("runtime_already_running") from e
    try:
        register_adapter()
        try:
            from astrbot.core import LogBroker,LogManager,db_helper,logger
            from astrbot.core.initial_loader import InitialLoader
            from astrbot.cli.utils.basic import check_dashboard
        except ImportError as e: raise BootstrapError("astrbot_api_incompatible") from e
        checked=check_dashboard(root/"data")
        if inspect.isawaitable(checked): await checked
        broker=LogBroker(); LogManager.set_queue_handler(logger,broker); loader=InitialLoader(db_helper,broker)
        start=getattr(loader,"start",None)
        if not callable(start): raise BootstrapError("astrbot_loader_incompatible")
        result=start()
        if not inspect.isawaitable(result): raise BootstrapError("astrbot_loader_incompatible")
        await result
        raise BootstrapError("runtime_stopped")
    finally: lock.release()
def main(argv: list[str]|None=None)->int:
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument("--runtime-root",required=True,help="absolute initialized AstrBot runtime path"); parser.add_argument("--check",action="store_true",help="validate setup without starting AstrBot"); args=parser.parse_args(argv)
    try:
        root=runtime_root(args.runtime_root); validate(read_config(root)); verify_version()
        if args.check:
            print(json.dumps({"astrbot_version":PINNED_VERSION,"dashboard_host":"127.0.0.1","request_attempts":1},separators=(",",":"))); return 0
        runtime_path=str(root)
        if runtime_path not in sys.path: sys.path.insert(0,runtime_path)
        os.environ["ASTRBOT_ROOT"]=runtime_path; os.environ["ASTRBOT_CLI"]="1"; os.chdir(root); asyncio.run(serve(root)); return 0
    except BootstrapError as e: print(f"bootstrap_error:{e}",file=sys.stderr); return 2
    except (KeyboardInterrupt,asyncio.CancelledError): return 0
    except Exception: print("bootstrap_error:startup_failed",file=sys.stderr); return 2
if __name__=="__main__": raise SystemExit(main())
