from __future__ import annotations
import argparse, asyncio, base64, hmac, importlib.metadata, math, os, re, struct, sys, threading, uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable, Literal

MODEL = "BAAI/bge-small-zh-v1.5"
DIMENSION = 512
AGENT = "Mutsumi"
MAX_BODY = 65536
TIMEOUT = 30

def _offline(data: Path, cache: Path) -> None:
    os.environ["MEM0_TELEMETRY"] = "false"
    os.environ["MEM0_DIR"] = str(data)
    os.environ["FASTEMBED_CACHE_PATH"] = str(cache)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

def _versions() -> None:
    try:
        if importlib.metadata.version("mem0ai") != "2.2.1" or importlib.metadata.version("fastembed") != "0.8.1":
            raise RuntimeError
    except Exception:
        raise RuntimeError("memory service dependency unavailable or version mismatch") from None

def _absolute(value: str | Path, existing: bool) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute(): raise ValueError("directories must be absolute")
    path = path.resolve(strict=existing)
    if existing and not path.is_dir(): raise ValueError("directory unavailable")
    return path

def _config(data: Path) -> dict[str, Any]:
    return {
        "vector_store": {"provider": "qdrant", "config": {
            "collection_name": "mutsumi_memory_v1", "path": str(data / "qdrant"),
            "embedding_model_dims": DIMENSION, "on_disk": True}},
        "embedder": {"provider": "fastembed", "config": {"model": MODEL, "embedding_dims": DIMENSION}},
        "history_db_path": str(data / "history.db"),
        "llm": {"provider": "openai", "config": {
            "api_key": "unused-local-only", "openai_base_url": "http://127.0.0.1:9/v1", "model": "disabled"}},
    }

def _make_memory(data: Path, cache: Path, factory: Callable | None) -> Any:
    _offline(data, cache)
    _versions()
    try:
        if factory is None:
            from mem0 import Memory
            memory = Memory.from_config(_config(data))
        else: memory = factory(_config(data))
        client = getattr(getattr(memory, "llm", None), "client", None)
        if client is not None and hasattr(client, "max_retries"): client.max_retries = 0
        dense = getattr(getattr(memory, "embedding_model", None), "dense_model", None)
        if dense is not None and getattr(dense, "embedding_size", DIMENSION) != DIMENSION: raise RuntimeError
        return memory
    except Exception: raise RuntimeError("memory service startup failed") from None

def build_service(data_dir: str | Path, cache_dir: str | Path, token: str,
                  memory_factory: Callable | None = None):
    if not isinstance(token, str) or len(token) < 24: raise ValueError("API key must contain at least 24 characters")
    data, cache = _absolute(data_dir, False), _absolute(cache_dir, True)
    data.mkdir(parents=True, exist_ok=True)
    _offline(data, cache)
    from fastapi import FastAPI, Request, HTTPException
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse
    from filelock import FileLock, Timeout as LockTimeout
    from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

    class StrictRequest(BaseModel):
        model_config = ConfigDict(extra="forbid", strict=True)

    id_re = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,95}$", re.ASCII)
    def valid_id(value: str, maximum: int = 96) -> str:
        if len(value) > maximum or not id_re.fullmatch(value): raise ValueError("invalid identifier")
        return value

    class Source(StrictRequest):
        user_id: StrictStr = Field(min_length=1, max_length=64)
        text: StrictStr = Field(min_length=1, max_length=400)
        source_session_id: StrictStr = Field(min_length=1, max_length=96)
        source_turn_id: StrictStr = Field(min_length=1, max_length=96)
        source_kind: Literal["explicit_user", "model_candidate"]
        @field_validator("user_id")
        @classmethod
        def user(cls, v): return valid_id(v, 64)
        @field_validator("source_session_id", "source_turn_id")
        @classmethod
        def refs(cls, v): return valid_id(v)
        @field_validator("text")
        @classmethod
        def nonblank(cls, v):
            if not v.strip(): raise ValueError("blank text")
            return v

    class Search(StrictRequest):
        user_id: StrictStr = Field(min_length=1, max_length=64)
        query: StrictStr = Field(min_length=1, max_length=400)
        limit: int = Field(ge=1, le=8, strict=True)
        @field_validator("user_id")
        @classmethod
        def user(cls, v): return valid_id(v, 64)
        @field_validator("query")
        @classmethod
        def nonblank(cls, v):
            if not v.strip(): raise ValueError("blank query")
            return v

    class Listing(StrictRequest):
        user_id: StrictStr = Field(min_length=1, max_length=64)
        limit: int = Field(ge=1, le=100, strict=True)
        @field_validator("user_id")
        @classmethod
        def user(cls, v): return valid_id(v, 64)

    class MemoryId(StrictRequest):
        user_id: StrictStr = Field(min_length=1, max_length=64)
        memory_id: StrictStr
        @field_validator("user_id")
        @classmethod
        def user(cls, v): return valid_id(v, 64)
        @field_validator("memory_id")
        @classmethod
        def canonical_uuid(cls, v):
            try: parsed = uuid.UUID(v)
            except (ValueError, AttributeError): raise ValueError("invalid memory id") from None
            if str(parsed) != v: raise ValueError("invalid memory id")
            return v

    class Confirm(MemoryId):
        source_session_id: StrictStr = Field(min_length=1, max_length=96)
        source_turn_id: StrictStr = Field(min_length=1, max_length=96)
        @field_validator("source_session_id", "source_turn_id")
        @classmethod
        def refs(cls, v): return valid_id(v)

    class Update(Confirm):
        text: StrictStr = Field(min_length=1, max_length=400)
        @field_validator("text")
        @classmethod
        def nonblank(cls, v):
            if not v.strip(): raise ValueError("blank text")
            return v

    class Embedding(StrictRequest):
        model: Literal[MODEL]
        input: StrictStr | list[StrictStr]
        encoding_format: Literal["float", "base64"] = "float"
        @field_validator("input")
        @classmethod
        def inputs(cls, v):
            items = [v] if isinstance(v, str) else v
            if not 1 <= len(items) <= 32 or any(not x.strip() or len(x) > 400 for x in items):
                raise ValueError("input outside bounds")
            return v

    state: dict[str, Any] = {"memory": None, "lock": None}
    operations = threading.Lock()
    @asynccontextmanager
    async def lifespan(app):
        guard = FileLock(str(data / ".memory-service.lock"))
        try:
            guard.acquire(timeout=0)
            state["lock"] = guard
            state["memory"] = await asyncio.to_thread(_make_memory, data, cache, memory_factory)
            yield
        except LockTimeout: raise RuntimeError("memory service already running") from None
        finally:
            mem = state.pop("memory", None)
            if mem is not None:
                try:
                    client = getattr(getattr(mem, "vector_store", None), "client", None)
                    if callable(getattr(client, "close", None)): await asyncio.to_thread(client.close)
                    db = getattr(mem, "db", None)
                    if callable(getattr(db, "close", None)): await asyncio.to_thread(db.close)
                except Exception: pass
            held = state.pop("lock", None)
            if held is not None and held.is_locked: held.release()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    @app.middleware("http")
    async def body_limit(request: Request, call_next):
        buf = bytearray()
        more = True
        while more:
            msg = await request.receive()
            if msg["type"] == "http.disconnect":
                return JSONResponse(status_code=400, content={"detail": "invalid_request"})
            chunk = msg.get("body", b"")
            if len(buf) + len(chunk) > MAX_BODY:
                return JSONResponse(status_code=413, content={"detail": "request_too_large"})
            buf.extend(chunk)
            more = msg.get("more_body", False)
        request._body = bytes(buf)
        async def replay():
            nonlocal buf
            payload = bytes(buf)
            buf.clear()
            return {"type": "http.request", "body": payload, "more_body": False}
        request._receive = replay
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": "invalid_request"})
    @app.exception_handler(Exception)
    async def safe_error(request: Request, exc: Exception):
        return JSONResponse(status_code=503, content={"detail": "service_unavailable"})

    def key_ok(value): return isinstance(value, str) and hmac.compare_digest(value, token)
    def auth_memory(request):
        if not key_ok(request.headers.get("x-api-key")): raise HTTPException(status_code=401, detail="unauthorized")
    def auth_embedding(request):
        value = request.headers.get("x-api-key")
        if value is None:
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "): value = auth[7:]
        if not key_ok(value): raise HTTPException(status_code=401, detail="unauthorized")

    async def call(fn):
        def locked():
            with operations:
                if state["memory"] is None: raise RuntimeError("not ready")
                return fn()
        try: return await asyncio.wait_for(asyncio.to_thread(locked), timeout=TIMEOUT)
        except asyncio.TimeoutError: raise HTTPException(status_code=503, detail="operation_outcome_unknown") from None
        except HTTPException: raise
        except Exception: raise HTTPException(status_code=503, detail="service_unavailable") from None

    def owned(mem, user_id, memory_id):
        item = mem.get(memory_id)
        if not isinstance(item, dict) or item.get("user_id") != user_id or item.get("agent_id") != AGENT: return None
        if not isinstance(item.get("metadata"), dict): item["metadata"] = {}
        return item

    fields = ("status", "source_session_id", "source_turn_id", "source_kind", "created_by",
              "confirmed_by_explicit_user", "confirmation_session_id", "confirmation_turn_id",
              "last_correction_session_id", "last_correction_turn_id")
    def project(item, score=None):
        meta = item.get("metadata") or {}
        result = {"id": item["id"], "text": item.get("memory", ""),
                  "metadata": {k: meta[k] for k in fields if k in meta}}
        if score is not None and math.isfinite(score): result["semantic_similarity"] = score
        return result
    def source_meta(body, status):
        return {"status": status, "source_session_id": body.source_session_id,
                "source_turn_id": body.source_turn_id, "source_kind": body.source_kind, "created_by": "mutsumi"}

    @app.get("/health")
    async def health():
        return {"status": "ok", "memory": "Mem0", "version": "2.2.1", "embedding_model": MODEL,
                "dimension": DIMENSION, "memory_mode": "explicit_and_candidates",
                "llm_inference": False, "retrieval": "semantic"}

    async def add(body, request, kind):
        auth_memory(request)
        if body.source_kind != kind: raise HTTPException(status_code=422, detail="invalid_request")
        status = "confirmed" if kind == "explicit_user" else "candidate"
        raw = await call(lambda: state["memory"].add(body.text, user_id=body.user_id, agent_id=AGENT,
                          metadata=source_meta(body, status), infer=False))
        ids = [str(x["id"]) for x in raw.get("results", []) if isinstance(x, dict) and x.get("id")]
        return {"status": status, "ids": ids[:8]}
    @app.post("/memory/candidates")
    async def candidates(body: Source, request: Request): return await add(body, request, "model_candidate")
    @app.post("/memory/remember")
    async def remember(body: Source, request: Request): return await add(body, request, "explicit_user")

    @app.post("/memory/search")
    async def search(body: Search, request: Request):
        auth_memory(request)
        def perform():
            mem = state["memory"]
            raw = mem.search(body.query, filters={"user_id": body.user_id, "agent_id": AGENT, "status": "confirmed"},
                             top_k=body.limit, rerank=False)
            rows = []
            for row in raw.get("results", []) if isinstance(raw, dict) else []:
                if not isinstance(row, dict) or not row.get("id"): continue
                item = owned(mem, body.user_id, str(row["id"]))
                if item is None or item.get("metadata", {}).get("status") != "confirmed": continue
                val = row.get("score")
                score = float(val) if isinstance(val, (int, float)) and not isinstance(val, bool) and math.isfinite(val) else None
                rows.append(project(item, score))
            return {"results": rows[:body.limit]}
        return await call(perform)

    @app.post("/memory/list")
    async def listing(body: Listing, request: Request):
        auth_memory(request)
        def perform():
            mem = state["memory"]
            raw = mem.get_all(filters={"user_id": body.user_id, "agent_id": AGENT}, top_k=body.limit)
            rows = []
            for row in raw.get("results", []) if isinstance(raw, dict) else []:
                if isinstance(row, dict) and row.get("id"):
                    item = owned(mem, body.user_id, str(row["id"]))
                    if item is not None: rows.append(project(item))
            return {"results": rows[:body.limit]}
        return await call(perform)

    @app.post("/memory/confirm")
    async def confirm(body: Confirm, request: Request):
        auth_memory(request)
        def perform():
            mem = state["memory"]
            item = owned(mem, body.user_id, body.memory_id)
            if item is None: return None
            meta = dict(item["metadata"])
            meta.update({"status": "confirmed", "confirmed_by_explicit_user": True,
                         "confirmation_session_id": body.source_session_id, "confirmation_turn_id": body.source_turn_id})
            mem.update(body.memory_id, metadata=meta)
            return owned(mem, body.user_id, body.memory_id)
        item = await call(perform)
        if item is None: raise HTTPException(status_code=404, detail="not_found")
        return {"status": "confirmed", "memory": project(item)}

    @app.post("/memory/update")
    async def update(body: Update, request: Request):
        auth_memory(request)
        def perform():
            mem = state["memory"]
            item = owned(mem, body.user_id, body.memory_id)
            if item is None: return None
            meta = dict(item["metadata"])
            meta["last_correction_session_id"] = body.source_session_id
            meta["last_correction_turn_id"] = body.source_turn_id
            mem.update(body.memory_id, text=body.text, metadata=meta)
            changed = owned(mem, body.user_id, body.memory_id)
            if changed is None or changed.get("memory") != body.text: raise RuntimeError
            return changed
        item = await call(perform)
        if item is None: raise HTTPException(status_code=404, detail="not_found")
        return {"status": "ok", "memory": project(item)}

    @app.post("/memory/delete")
    async def delete(body: MemoryId, request: Request):
        auth_memory(request)
        def perform():
            mem = state["memory"]
            if owned(mem, body.user_id, body.memory_id) is None: return False
            mem.delete(body.memory_id)
            return mem.get(body.memory_id) is None
        if not await call(perform): raise HTTPException(status_code=404, detail="not_found")
        return {"status": "ok", "active_retrieval_deleted": True, "history_retained": True}

    @app.post("/v1/embeddings")
    async def embeddings(body: Embedding, request: Request):
        auth_embedding(request)
        texts = [body.input] if isinstance(body.input, str) else body.input
        def perform():
            dense = state["memory"].embedding_model.dense_model
            vectors = []
            for text in texts:
                vector = list(next(iter(dense.embed(text))))
                if len(vector) != DIMENSION or any(not math.isfinite(float(x)) for x in vector):
                    raise RuntimeError("invalid embedding")
                if body.encoding_format == "base64":
                    raw = struct.pack("<" + "f" * DIMENSION, *(float(x) for x in vector))
                    vectors.append(base64.b64encode(raw).decode("ascii"))
                else: vectors.append([float(x) for x in vector])
            return {"object": "list", "model": MODEL,
                    "data": [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)]}
        return await call(perform)
    return app

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local Mem0 memory service")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--port", type=int, default=6186)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535: parser.error("--port must be between 1 and 65535")
    token = os.environ.get("MUTSUMI_MEMORY_API_KEY", "")
    if len(token) < 24: parser.error("MUTSUMI_MEMORY_API_KEY must contain at least 24 characters")
    try:
        data, cache = _absolute(args.data_dir, False), _absolute(args.cache_dir, True)
        _offline(data, cache)
        _versions()
        app = build_service(data, cache, token)
        import uvicorn
        os.environ.setdefault("OMP_NUM_THREADS", "2")
        uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, log_config=None)
        return 0
    except Exception:
        sys.stderr.write("memory service startup failed\n")
        return 1

if __name__ == "__main__": raise SystemExit(main())

