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
@pytest.mark.parametrize("filename, content, expected", [
    ("test.csv", b"machine,event\nM1,start\nM2,stop\n", {"machine": "M2", "event": "stop"}),
    ("test.jsonl", b'{"event_id":"a"}\n{"event_id":"a","quantity":0,"machine_id":null,"metadata":{"ok":false}}\n', {"event_id": "a", "quantity": 0, "machine_id": None, "metadata": {"ok": False}}),
])
def test_postgres_import_pagination_and_restart(monkeypatch, filename, content, expected):
    monkeypatch.setenv("DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    monkeypatch.setenv("BASIC_AUTH_USERNAME", "reviewer")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "test-password")
    auth = ("reviewer", "test-password")
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200
        response = client.post("/api/datasets", auth=auth, content=content, headers={"x-helicon-request": "1", "x-file-name": filename})
        assert response.status_code == 201
        dataset_id = response.json()["id"]
        rows = client.get(f"/api/datasets/{dataset_id}/rows?limit=1&offset=1", auth=auth).json()
        assert rows["rows"] == [{"row_number": 2, "data": expected}]
    with TestClient(create_app()) as client:
        assert client.get(f"/api/datasets/{dataset_id}/rows", auth=auth).json()["dataset"]["row_count"] == 2
        response = client.delete(f"/api/datasets/{dataset_id}", auth=auth, headers={"x-helicon-request": "1"})
        assert response.status_code == 200
        assert client.get(f"/api/datasets/{dataset_id}/rows", auth=auth).status_code == 404
        assert client.delete(f"/api/datasets/{dataset_id}", auth=auth, headers={"x-helicon-request": "1"}).status_code == 404
        with client.app.state.pool.connection() as conn:
            assert conn.execute("SELECT count(*) AS count FROM dataset_rows WHERE dataset_id = %s", (dataset_id,)).fetchone()["count"] == 0


def test_jsonl_upload_validation(client):
    response = client.post('/api/datasets', auth=('reviewer', 'test-password'),
                           content=b'{"event_id":"a"}\ninvalid',
                           headers={'x-helicon-request': '1', 'x-file-name': 'events.jsonl'})
    assert response.status_code == 422
    assert 'JSONL line 2:' in response.json()['detail']


def test_delete_requires_auth_and_same_origin_header(client):
    path = '/api/datasets/00000000-0000-0000-0000-000000000001'
    assert client.delete(path).status_code == 401
    assert client.delete(path, auth=('reviewer', 'test-password')).status_code == 403
    assert client.delete(path, auth=('reviewer', 'test-password'), headers={'x-helicon-request': '1', 'sec-fetch-site': 'cross-site'}).status_code == 403
