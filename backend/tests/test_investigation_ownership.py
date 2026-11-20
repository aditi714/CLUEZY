"""Tests for investigation ownership enforcement, cross-user isolation, and claiming anonymous sessions."""

import pytest
from httpx import AsyncClient
from app.models.investigation import Investigation


@pytest.mark.asyncio
async def test_authenticated_user_can_create_and_retrieve_investigation(
    client: AsyncClient,
    user_a_headers: dict,
):
    """Authenticated user creates an investigation and verifies it has user_id and can be retrieved."""
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "Laptop screen flickers when plugged in."},
        headers=user_a_headers,
    )
    assert create_res.status_code == 201
    data = create_res.json()["data"]
    ref_id = data["reference_id"]
    assert data["user_id"] == "usr_00000000-0000-0000-0000-00000000000a"

    # User A retrieves investigation
    get_res = await client.get(f"/api/v1/investigations/{ref_id}", headers=user_a_headers)
    assert get_res.status_code == 200
    assert get_res.json()["data"]["reference_id"] == ref_id


@pytest.mark.asyncio
async def test_cross_user_isolation(
    client: AsyncClient,
    user_a_headers: dict,
    user_b_headers: dict,
):
    """User B cannot access or modify User A's investigation."""
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "Wi-Fi is dropping constantly on Ubuntu."},
        headers=user_a_headers,
    )
    assert create_res.status_code == 201
    ref_id = create_res.json()["data"]["reference_id"]

    # User B tries to view User A's investigation -> 404 (isolation)
    get_res = await client.get(f"/api/v1/investigations/{ref_id}", headers=user_b_headers)
    assert get_res.status_code == 404

    # User B tries to progress User A's investigation -> 404
    prog_res = await client.post(
        f"/api/v1/investigations/{ref_id}/progress",
        json={"user_message": "Attempting unauthorized progress"},
        headers=user_b_headers,
    )
    assert prog_res.status_code == 404


@pytest.mark.asyncio
async def test_anonymous_user_cannot_access_authenticated_investigation(
    client: AsyncClient,
    user_a_headers: dict,
    auth_headers: dict,
):
    """Anonymous session cannot access an investigation created by an authenticated user."""
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "PostgreSQL database connection timeout."},
        headers=user_a_headers,
    )
    assert create_res.status_code == 201
    ref_id = create_res.json()["data"]["reference_id"]

    # Anonymous user with X-Session-Token tries to view
    anon_get = await client.get(f"/api/v1/investigations/{ref_id}", headers=auth_headers)
    assert anon_get.status_code == 404


@pytest.mark.asyncio
async def test_claim_anonymous_investigation_flow(
    client: AsyncClient,
    auth_headers: dict,
    user_a_headers: dict,
    test_session,
):
    """Anonymous user starts an investigation, then signs in and claims the investigation."""
    # 1. Anonymous user creates investigation
    create_res = await client.post(
        "/api/v1/investigations",
        json={"problem_description": "My keyboard spacebar is unresponsive."},
        headers=auth_headers,
    )
    assert create_res.status_code == 201
    ref_id = create_res.json()["data"]["reference_id"]
    inv_id = create_res.json()["data"]["id"]

    # 2. Authenticated User A claims anonymous investigation using the session token
    claim_res = await client.post(
        "/api/v1/investigations/claim-anonymous",
        json={"session_token": test_session.session_token},
        headers=user_a_headers,
    )
    assert claim_res.status_code == 200
    claim_data = claim_res.json()["data"]
    assert claim_data["claimed_count"] >= 1
    assert ref_id in claim_data["reference_ids"]

    # 3. User A can now access the investigation using their Bearer token
    user_get = await client.get(f"/api/v1/investigations/{ref_id}", headers=user_a_headers)
    assert user_get.status_code == 200
    assert user_get.json()["data"]["user_id"] == "usr_00000000-0000-0000-0000-00000000000a"

    # 4. Repeat claim is idempotent
    repeat_claim = await client.post(
        "/api/v1/investigations/claim-anonymous",
        json={"session_token": test_session.session_token},
        headers=user_a_headers,
    )
    assert repeat_claim.status_code == 200

