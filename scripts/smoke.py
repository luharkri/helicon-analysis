"""Verify the deployed app. Set APP_URL and BASIC_AUTH_PASSWORD; optionally DATASET_ID."""
import os
from pathlib import Path

import httpx


def main():
    with httpx.Client(base_url=os.environ["APP_URL"], timeout=60) as client:
        for path in ["/", "/api/datasets", "/docs", "/api/sample"]:
            assert client.get(path).status_code == 401, path
        assert client.get("/health").status_code == 200
        client.auth = (os.environ.get("BASIC_AUTH_USERNAME", "reviewer"), os.environ["BASIC_AUTH_PASSWORD"])
        response = client.get("/")
        assert response.status_code == 200 and 'id="root"' in response.text
        dataset_id = os.environ.get("DATASET_ID")
        if not dataset_id:
            response = client.post("/api/datasets", content=Path("samples/mock-events.csv").read_bytes(),
                                   headers={"X-Helicon-Request": "1", "X-File-Name": "mock-events.csv", "Content-Type": "text/csv"})
            assert response.status_code == 201, response.text
            dataset_id = response.json()["id"]
            before = len(client.get("/api/datasets").json())
            response = client.post("/api/datasets", content=b"a,a\n1,2", headers={"X-Helicon-Request": "1"})
            assert response.status_code == 422
            assert len(client.get("/api/datasets").json()) == before
        page = client.get(f"/api/datasets/{dataset_id}/rows").json()
        assert page["dataset"]["row_count"] == 8 and len(page["rows"]) == 8
        assert page["rows"][0]["data"]["machine"] == "Press-01"
        response = client.get(f"/api/datasets/{dataset_id}/rows?offset=7&limit=1")
        assert response.json()["rows"][0]["row_number"] == 8
        print(f"PASS: auth, health, UI response, stored rows and pagination. Dataset: {dataset_id}")
        return dataset_id


if __name__ == "__main__":
    main()
