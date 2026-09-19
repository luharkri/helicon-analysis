# Helicon — Production Log Analysis

Explore manufacturing event logs to identify blocked jobs, tooling delays, scrap losses, and customer output shortfalls. Charts link to supporting jobs and event histories.

**[Live app](https://web-production-11feb.up.railway.app)** · Username: `reviewer` · Password shared separately.

## Dashboards

| Tab | Purpose |
| --- | --- |
| Data | Upload JSONL/NDJSON or CSV, inspect records, and delete datasets |
| Summary | Overdue blocked jobs and parts with the highest scrap rates |
| Jobs | Unresolved blockers, ranked by duration, with event timelines |
| Tooling | Missing-tool delays and scrap associated with tools |
| Materials / Parts | Good output, scrap units, and scrap rates by material or part |
| Customer Shortfalls | Completed-job good output below original targets |
| Run Size vs Scrap | Filterable scatter plot, fitted trend, and exploratory outlier flags |

## Run locally

Requires Docker Compose. On first setup:

```sh
cp .env.example .env
# Set BASIC_AUTH_PASSWORD in .env.
docker compose up --build -d
```

Open **http://localhost:8000** and sign in with the credentials in `.env`.

For automatic updates while editing:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up
```

Open **http://localhost:5173**. Frontend changes update automatically; backend changes restart the API. Both modes share the same Postgres volume. Rebuild after Python dependency changes. `.env` is ignored by Git.

## Data and calculations

- Uploads accept UTF-8 files up to 10 MB, 100,000 records, and 100 top-level fields. JSONL requires one object per line; CSV requires headers. Invalid files are rejected atomically.
- Imported records are preserved as JSONB. Analytics use the first imported record per event ID, disclose conflicts, and order events by timestamp. The latest valid event sets the historical **as-of** time.
- A job is unfinished without a recorded completion. Blocks remain unresolved until an unblock or completion; production activity alone does not clear them.
- Output metrics use the latest completion snapshot. Scrap rate is total scrap / (good + scrap). Shortfall is `max(original target − good output, 0)` per job, then summed.
- Tool associations are inferred from job history. Missing/conflicting associations are labeled unknown. Tooling delays measure **job-hours**, not physical tool downtime; associations do not prove defect causation.
- Run-size flags exceed three residual standard deviations from an unweighted linear fit. These are exploratory signals, not validated predictions. Customer shortfalls do not establish shipment shortages.

## Stack and deployment

React + TypeScript + Vite, FastAPI, and Postgres. One Docker image serves the production UI and API; Postgres stores datasets separately. Basic Auth protects the application. `/health` checks database availability.

Railway requires `DATABASE_URL`, `BASIC_AUTH_USERNAME`, and `BASIC_AUTH_PASSWORD`. Deploy from a linked checkout:

```sh
npx @railway/cli up --service web --detach
```

GitHub push-to-deploy has not been verified; CLI deployment is used.

## Validation

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
npm --prefix frontend ci
npm --prefix frontend run build
```

Set `TEST_DATABASE_URL` to a disposable Postgres database to include integration tests. CI runs tests with Postgres and builds the frontend. Browser interaction checks are separate from these automated checks.
