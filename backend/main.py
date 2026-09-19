import base64
import binascii
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from starlette.concurrency import run_in_threadpool

from backend.csv_import import MAX_BYTES, parse_csv
from backend.jsonl_import import parse_jsonl
from backend.dashboard import analyze, tooling, good_output, tool_scrap, materials, parts, run_size

ROOT = Path(__file__).resolve().parent.parent


def create_app():
    username = os.environ.get("BASIC_AUTH_USERNAME", "")
    password = os.environ.get("BASIC_AUTH_PASSWORD", "")
    database_url = os.environ.get("DATABASE_URL", "")
    if not username or not password or not database_url:
        raise RuntimeError("DATABASE_URL, BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required.")

    @asynccontextmanager
    async def lifespan(app):
        pool = ConnectionPool(database_url, min_size=1, max_size=5, open=False, kwargs={"row_factory": dict_row})
        app.state.pool = pool
        await run_in_threadpool(pool.open, wait=True, timeout=30)
        def initialize():
            with pool.connection() as conn:
                conn.execute("""CREATE TABLE IF NOT EXISTS datasets (
                    id UUID PRIMARY KEY, name TEXT NOT NULL, columns JSONB NOT NULL,
                    row_count INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )""")
                conn.execute("""CREATE TABLE IF NOT EXISTS dataset_rows (
                    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                    row_number INTEGER NOT NULL, data JSONB NOT NULL,
                    PRIMARY KEY (dataset_id, row_number)
                )""")
        try:
            await run_in_threadpool(initialize)
            yield
        finally:
            await run_in_threadpool(pool.close)

    app = FastAPI(title="Helicon", lifespan=lifespan)

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if request.url.path != "/health":
            valid = False
            try:
                scheme, token = request.headers.get("authorization", "").split(" ", 1)
                raw = base64.b64decode(token, validate=True).decode("utf-8")
                supplied_user, supplied_password = raw.split(":", 1)
                user_ok = secrets.compare_digest(supplied_user.encode(), username.encode())
                password_ok = secrets.compare_digest(supplied_password.encode(), password.encode())
                valid = scheme.lower() == "basic" and user_ok and password_ok
            except (ValueError, UnicodeDecodeError, binascii.Error):
                pass
            if not valid:
                return JSONResponse({"detail": "Authentication required."}, status_code=401,
                                    headers={"WWW-Authenticate": 'Basic realm="Helicon", charset="UTF-8"'})
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                # Browser Basic Auth is ambient: require a same-origin JS-only header.
                if request.headers.get("x-helicon-request") != "1" or request.headers.get("sec-fetch-site") == "cross-site":
                    return JSONResponse({"detail": "Upload from this application's page."}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.get("/health")
    def health():
        try:
            with app.state.pool.connection(timeout=3) as conn:
                conn.execute("SELECT 1")
        except Exception:
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return {"status": "ok"}

    @app.get("/api/datasets")
    def datasets():
        with app.state.pool.connection() as conn:
            return conn.execute("SELECT * FROM datasets ORDER BY created_at DESC, id DESC").fetchall()

    @app.post("/api/datasets", status_code=201)
    async def upload(request: Request):
        # Raw file body avoids multipart spooling before enforcing the size limit.
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise HTTPException(413, "File exceeds the 10 MB limit.")
        name = request.headers.get("x-file-name", "uploaded.csv")[:255]
        from urllib.parse import unquote
        name = unquote(name).replace("\\", "/").split("/")[-1] or "uploaded.csv"
        extension = Path(name).suffix.lower()
        if extension not in {".csv", ".jsonl", ".ndjson"}:
            raise HTTPException(422, "Choose a .csv, .jsonl, or .ndjson file.")
        try:
            parser = parse_csv if extension == ".csv" else parse_jsonl
            columns, rows = await run_in_threadpool(parser, bytes(content))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        def save():
            dataset_id = uuid4()
            with app.state.pool.connection() as conn:
                dataset = conn.execute(
                    "INSERT INTO datasets (id, name, columns, row_count) VALUES (%s, %s, %s, %s) RETURNING *",
                    (dataset_id, name, Jsonb(columns), len(rows)),
                ).fetchone()
                with conn.cursor() as cursor:
                    cursor.executemany("INSERT INTO dataset_rows (dataset_id, row_number, data) VALUES (%s, %s, %s)",
                                       [(dataset_id, i, Jsonb(row)) for i, row in enumerate(rows, 1)])
            return dataset
        return await run_in_threadpool(save)

    @app.delete("/api/datasets/{dataset_id}")
    def delete_dataset(dataset_id: UUID):
        with app.state.pool.connection() as conn:
            deleted = conn.execute("DELETE FROM datasets WHERE id = %s RETURNING id", (dataset_id,)).fetchone()
            if not deleted:
                raise HTTPException(404, "Dataset not found.")
        return {"deleted": str(dataset_id)}

    @app.get("/api/datasets/{dataset_id}/rows")
    def dataset_rows(dataset_id: UUID, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
        with app.state.pool.connection() as conn:
            dataset = conn.execute("SELECT * FROM datasets WHERE id = %s", (dataset_id,)).fetchone()
            if not dataset:
                raise HTTPException(404, "Dataset not found.")
            rows = conn.execute("SELECT row_number, data FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number LIMIT %s OFFSET %s",
                                (dataset_id, limit, offset)).fetchall()
        return {"dataset": dataset, "rows": rows, "offset": offset, "limit": limit}

    def dashboard_data(dataset_id):
        with app.state.pool.connection() as conn:
            if not conn.execute("SELECT id FROM datasets WHERE id = %s", (dataset_id,)).fetchone():
                raise HTTPException(404, "Dataset not found.")
            records = conn.execute("SELECT row_number, data FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number", (dataset_id,)).fetchall()
        try:
            return analyze(records)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/datasets/{dataset_id}/production-overview")
    def production_overview(dataset_id: UUID):
        overview, jobs = dashboard_data(dataset_id)
        # Summary counts must include every blocked job, not just the chart's top ten.
        overview['jobs'] = [{k: v for k, v in job.items() if k not in ('timeline', 'created')}
                            for job in jobs.values() if not job['completed'] and job['blocker']]
        return overview

    @app.get("/api/datasets/{dataset_id}/blocked")
    def blocked(dataset_id: UUID):
        overview, _ = dashboard_data(dataset_id)
        return overview

    @app.get("/api/datasets/{dataset_id}/good-output")
    def output_shortfall(dataset_id: UUID):
        overview, jobs = dashboard_data(dataset_id)
        return good_output(overview, jobs)

    @app.get("/api/datasets/{dataset_id}/run-size")
    def run_size_analysis(dataset_id: UUID):
        overview, jobs = dashboard_data(dataset_id)
        return run_size(overview, jobs)

    @app.get("/api/datasets/{dataset_id}/parts")
    def part_output(dataset_id: UUID):
        overview, jobs = dashboard_data(dataset_id)
        return parts(overview, jobs)

    @app.get("/api/datasets/{dataset_id}/materials")
    def material_output(dataset_id: UUID):
        overview, jobs = dashboard_data(dataset_id)
        return materials(overview, jobs)

    @app.get("/api/datasets/{dataset_id}/tool-scrap")
    def scrap_by_tool(dataset_id: UUID):
        overview, jobs = dashboard_data(dataset_id)
        return tool_scrap(overview, jobs)

    @app.get("/api/datasets/{dataset_id}/tooling")
    def tooling_delays(dataset_id: UUID, scope: str = Query('unresolved', pattern='^(unresolved|all)$')):
        overview, jobs = dashboard_data(dataset_id)
        return tooling(overview, jobs, scope)

    @app.get("/api/datasets/{dataset_id}/jobs/{job_id}")
    def job_detail(dataset_id: UUID, job_id: str):
        overview, jobs = dashboard_data(dataset_id)
        if job_id not in jobs:
            raise HTTPException(404, "Job not found.")
        return {"as_of": overview["as_of"], "job": jobs[job_id]}

    @app.get("/api/sample")
    def sample():
        return FileResponse(ROOT / "samples/mock-events.csv", media_type="text/csv", filename="mock-events.csv")

    dist = ROOT / "frontend/dist"
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(dist / "index.html")

    return app
