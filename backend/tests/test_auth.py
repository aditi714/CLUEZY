"""Tests for Supabase JWT token verification, user metadata derivation, and authentication dependencies."""

import pytest
from fastapi import HTTPException
from app.core.auth import AuthenticatedUser, supabase_auth_verifier
from tests.conftest import create_mock_jwt


def test_authenticated_user_properties():
    """Verify display_name and avatar_url derivation from user_metadata and email."""
    user = AuthenticatedUser(
        id="usr-123",
        email="aditi@example.com",
        user_metadata={"full_name": "Aditi", "avatar_url": "https://lh3.googleusercontent.com/photo.jpg"},
    )
    assert user.id == "usr-123"
    assert user.display_name == "Aditi"
    assert user.avatar_url == "https://lh3.googleusercontent.com/photo.jpg"

    user_email_only = AuthenticatedUser(id="usr-456", email="engineer@gmail.com")
    assert user_email_only.display_name == "engineer"
    assert user_email_only.avatar_url is None


def test_verify_valid_token():
    """Verify that a validly signed token is accepted and returns AuthenticatedUser."""
    token = create_mock_jwt(user_id="usr-test-1", email="tester@cluezy.ai")
    user = supabase_auth_verifier.verify_token(token)
    assert user.id == "usr-test-1"
    assert user.email == "tester@cluezy.ai"
    assert user.role == "authenticated"


def test_verify_expired_token():
    """Verify that an expired token raises 401 with appropriate message."""
    token = create_mock_jwt(user_id="usr-test-expired", expires_in_seconds=-10)
    with pytest.raises(HTTPException) as exc_info:
        supabase_auth_verifier.verify_token(token)
    assert exc_info.value.status_code == 401
    assert "expired" in str(exc_info.value.detail).lower()


def test_verify_tampered_token():
    """Verify that a tampered or incorrectly signed token raises 401."""
    token = create_mock_jwt(user_id="usr-test-tampered")
    tampered = token[:-5] + "XXXXX"
    with pytest.raises(HTTPException) as exc_info:
        supabase_auth_verifier.verify_token(tampered)
    assert exc_info.value.status_code == 401


def test_verify_missing_token():
    """Verify that an empty token raises 401."""
    with pytest.raises(HTTPException) as exc_info:
        supabase_auth_verifier.verify_token("")
    assert exc_info.value.status_code == 401

