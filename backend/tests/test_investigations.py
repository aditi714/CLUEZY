"""Tests for investigation creation and retrieval endpoints."""

import pytest
from httpx import AsyncClient
from app.core.security import SESSION_HEADER_NAME


@pytest.mark.asyncio
async def test_create_investigation_success(client: AsyncClient, auth_headers: dict):
    payload = {
        "problem_description": "My laptop is connected to Wi-Fi but websites aren't opening, though my phone works fine on the same network.",
        "title": "Laptop can't open websites (DNS issue)",
        "device_type": "Laptop (Windows)",
        "network_info": "Connected to Wi-Fi",
        "category": "Network",
    }
    response = await client.post("/api/v1/investigations", json=payload, headers=auth_headers)
    assert response.status_code == 201
    res = response.json()
    assert res["success"] is True
    data = res["data"]
    assert data["reference_id"].startswith("INV-")
    assert data["title"] == payload["title"]
    assert data["status"] == "active"
    assert len(data["messages"]) >= 2
    assert len(data["evidence"]) >= 2
    assert len(data["candidate_causes"]) >= 1
    assert len(data["recommended_actions"]) >= 1


@pytest.mark.asyncio
async def test_create_investigation_unauthorized(client: AsyncClient):
    payload = {
        "problem_description": "Cannot connect to database.",
    }
    response = await client.post("/api/v1/investigations", json=payload)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_investigations_empty(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/v1/investigations", headers=auth_headers)
    assert response.status_code == 200
    res = response.json()
    assert res["data"]["total"] == 0
    assert res["data"]["items"] == []


@pytest.mark.asyncio
async def test_list_investigations_with_records(client: AsyncClient, auth_headers: dict):
    # Create 2 investigations
    for i in range(2):
        await client.post(
            "/api/v1/investigations",
            json={"problem_description": f"Problem description number {i + 1}"},
            headers=auth_headers,
        )

    response = await client.get("/api/v1/investigations", headers=auth_headers)
    assert response.status_code == 200
    res = response.json()
    assert res["data"]["total"] == 2
    assert len(res["data"]["items"]) == 2
    assert res["data"]["items"][0]["message_count"] >= 2


@pytest.mark.asyncio
async def test_get_investigation_by_ref_and_id(client: AsyncClient, auth_headers: dict):
    create_res = await client.post(
        "/api/v1/investigations",
        json={
            "problem_description": "Laptop running very slow after system update",
            "title": "Slow laptop performance",
        },
        headers=auth_headers,
    )
    created = create_res.json()["data"]
    inv_id = created["id"]
    ref_id = created["reference_id"]

    # 1. Fetch by UUID
    res_id = await client.get(f"/api/v1/investigations/{inv_id}", headers=auth_headers)
    assert res_id.status_code == 200
    assert res_id.json()["data"]["id"] == inv_id

    # 2. Fetch by reference ID (INV-XXXX)
    res_ref = await client.get(f"/api/v1/investigations/{ref_id}", headers=auth_headers)
    assert res_ref.status_code == 200
    assert res_ref.json()["data"]["reference_id"] == ref_id


@pytest.mark.asyncio
async def test_get_investigation_not_found(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/v1/investigations/INV-9999", headers=auth_headers)
    assert response.status_code == 404

