import base64
import os

import pytest
from fastapi.testclient import TestClient

from backend.csv_import import parse_csv
from backend.main import create_app


def test_csv_preserves_values_and_handles_bom_quotes_and_blank_rows():
    columns, rows = parse_csv('\ufeffmachine,description\r\nM1,"a,b"\r\n\r\nM2,"two\nlines"\r\n'.encode())
    assert columns == ["machine", "description"]
    assert rows == [{"machine": "M1", "description": "a,b"}, {"machine": "M2", "description": "two\nlines"}]


@pytest.mark.parametrize("content", [b"", b"a,a\n1,2", b"a,\n1,2", b"a,b\n1", b"a,b\n", b"a\n\xff", b'a\n"unclosed', b"a\n\x00"])
def test_invalid_csv_is_rejected(content):
    with pytest.raises(ValueError):
        parse_csv(content)


def test_missing_configuration_fails_closed(monkeypatch):
    monkeypatch.delenv("BASIC_AUTH_PASSWORD", raising=False)
    with pytest.raises(RuntimeError):
        create_app()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    monkeypatch.setenv("BASIC_AUTH_USERNAME", "reviewer")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "test-password")
    # No lifespan here: auth and parsing must reject requests before DB access.
    return TestClient(create_app())


@pytest.mark.parametrize("path", ["/", "/api/datasets", "/docs", "/openapi.json", "/api/sample", "/assets/anything.js"])
def test_all_app_surfaces_require_auth(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert "Basic" in response.headers["www-authenticate"]


@pytest.mark.parametrize("token", ["Basic !!!", "Basic " + base64.b64encode(b"reviewer:wrong").decode(), "Bearer abc"])
def test_invalid_auth_is_rejected(client, token):
    assert client.get("/", headers={"authorization": token}).status_code == 401


def test_sample_is_available_with_auth(client):
    response = client.get("/api/sample", auth=("reviewer", "test-password"))
    assert response.status_code == 200
    assert "machine,event_type" in response.text


def test_upload_rejects_cross_site_and_invalid_data(client):
    auth = ("reviewer", "test-password")
    assert client.post("/api/datasets", auth=auth, content=b"a\n1").status_code == 403
    assert client.post("/api/datasets", auth=auth, content=b"a\n1", headers={"x-helicon-request": "1", "sec-fetch-site": "cross-site"}).status_code == 403
    assert client.post("/api/datasets", auth=auth, content=b"a,a\n1,2", headers={"x-helicon-request": "1"}).status_code == 422


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Requires a disposable PostgreSQL database")
def test_postgres_import_pagination_and_restart(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    monkeypatch.setenv("BASIC_AUTH_USERNAME", "reviewer")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "test-password")
    auth = ("reviewer", "test-password")
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200
        response = client.post("/api/datasets", auth=auth, content=b"machine,event\nM1,start\nM2,stop\n", headers={"x-helicon-request": "1", "x-file-name": "test.csv"})
        assert response.status_code == 201
        dataset_id = response.json()["id"]
        rows = client.get(f"/api/datasets/{dataset_id}/rows?limit=1&offset=1", auth=auth).json()
        assert rows["rows"] == [{"row_number": 2, "data": {"machine": "M2", "event": "stop"}}]
    with TestClient(create_app()) as client:
        assert client.get(f"/api/datasets/{dataset_id}/rows", auth=auth).json()["dataset"]["row_count"] == 2
        with client.app.state.pool.connection() as conn:
            conn.execute("DELETE FROM datasets WHERE id = %s", (dataset_id,))
