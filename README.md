# Helicon

A deployment foundation for a manufacturing event explorer. Upload a CSV, store it in Postgres, and browse its original records. The included sample is synthetic; no manufacturing metrics or schema are assumed yet.

## Stack and decisions

- React + TypeScript + Vite frontend; Python + FastAPI API.
- One Docker image: FastAPI serves both the built UI and API on one origin.
- Separate Postgres service. Each upload has a dataset ID; rows are JSONB with their original strings and ordering preserved. Add typed event tables after inspecting the real log.
- HTTP Basic Auth protects the UI, assets, docs, downloads, and API. Credentials live in environment variables. `/health` is public and returns only availability, including a database check.
- Uploads are atomic: invalid files produce no partial datasets. UTF-8 comma-separated CSV, unique nonempty headers, maximum 10 MB / 100,000 rows / 100 columns. Re-uploading intentionally creates a new dataset.
- No background queue or analytics engine yet. This slice verifies deployment and persistence before the timed build.

## Run locally

With Docker Compose:

```sh
cp .env.example .env
# Replace BASIC_AUTH_PASSWORD in .env.
docker compose up --build
```

Open http://localhost:8000 and use the credentials from `.env`. The named Postgres volume survives app rebuilds. `docker compose down -v` deletes that local database.

Without Docker, use an existing PostgreSQL database:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cd frontend
npm ci
npm run build
cd ..
# Export DATABASE_URL, BASIC_AUTH_USERNAME, BASIC_AUTH_PASSWORD in your shell.
.venv/bin/uvicorn backend.main:create_app --factory --host 127.0.0.1 --port 8000
```

## Deploy to Railway

1. Create a Railway project and add a **PostgreSQL** service named `Postgres`.
2. Add an app service from the GitHub repository, using branch `main`.
3. Set app variables:
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}` (reference the database's private URL).
   - `BASIC_AUTH_USERNAME=reviewer`.
   - `BASIC_AUTH_PASSWORD=<a long random password>`.
4. Railway reads `Dockerfile` and `railway.toml`. The app listens on Railway's `PORT`; `/health` must pass before the deployment becomes active.
5. In the app service's Networking settings, **Generate Domain**. Open the HTTPS URL and authenticate. The database does not need a public web domain or an app-side volume.
6. Keep deployment on push enabled for `main`.

Review the Railway plan and resource usage in the account dashboard. Store/share reviewer credentials separately from the repository. Basic Auth is a shared demo credential, not individual user accounts; browsers may retain it until the session closes.

## Acceptance check

- Unauthenticated `/` and `/api/datasets` return 401; authenticated requests work.
- Download and upload `samples/mock-events.csv`; verify eight stored records.
- Upload a malformed CSV; verify a clear error and no extra dataset.
- Push a visible UI change; wait for the healthy deployment at the same URL.
- Reload and verify the original dataset and rows still exist.

## Tests

```sh
.venv/bin/python -m pytest -q
# Optional real PostgreSQL integration test (uses a disposable DB):
TEST_DATABASE_URL=postgresql://... .venv/bin/python -m pytest -q
cd frontend && npm run build
```

Parser/auth tests run without Postgres. The integration test imports, paginates, recreates the application, and checks persistence. It removes its own test dataset afterward.

## Next, when the log arrives

Inspect columns and event meanings, define typed transformations, then build the most useful analysis. The upload and deployment path is independent of that product decision.
