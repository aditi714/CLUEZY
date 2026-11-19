"""Tests for anonymous session creation and retrieval endpoints."""

import pytest
from httpx import AsyncClient
from app.core.security import SESSION_HEADER_NAME


@pytest.mark.asyncio
async def test_create_anonymous_session_default(client: AsyncClient):
    response = await client.post("/api/v1/sessions")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    data = payload["data"]
    assert "session_token" in data
    assert data["session_token"].startswith("clz_")
    assert data["daily_token_limit"] == 200000
    assert data["tokens_used"] == 0
    assert data["remaining_tokens"] == 200000
    assert data["remaining_percentage"] == 100.0
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_create_anonymous_session_with_identifier(client: AsyncClient):
    response = await client.post(
        "/api/v1/sessions",
        json={"user_identifier": "Parth"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["user_identifier"] == "Parth"


@pytest.mark.asyncio
async def test_get_current_session_success(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/v1/sessions/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["session_token"] == auth_headers[SESSION_HEADER_NAME]


@pytest.mark.asyncio
async def test_get_current_session_missing_header(client: AsyncClient):
    response = await client.get("/api/v1/sessions/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_current_session_invalid_token(client: AsyncClient):
    headers = {SESSION_HEADER_NAME: "clz_invalid_token_12345"}
    response = await client.get("/api/v1/sessions/me", headers=headers)
    assert response.status_code == 401

