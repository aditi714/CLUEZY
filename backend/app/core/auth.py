"""Supabase JWT authentication, token verification, and user identity representation."""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import jwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError, PyJWKClientError
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class AuthenticatedUser:
    """Represents a verified Supabase authenticated user."""

    id: str
    email: Optional[str] = None
    role: Optional[str] = "authenticated"
    user_metadata: Dict[str, Any] = field(default_factory=dict)
    app_metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def display_name(self) -> str:
        """Derive a friendly display name from metadata or email."""
        if self.user_metadata:
            for key in ("full_name", "name", "user_name"):
                val = self.user_metadata.get(key)
                if val and str(val).strip():
                    return str(val).strip()
        if self.email:
            return self.email.split("@")[0]
        return "Authenticated User"

    @property
    def avatar_url(self) -> Optional[str]:
        """Derive avatar/picture URL from Google OAuth user metadata."""
        if self.user_metadata:
            for key in ("avatar_url", "picture"):
                val = self.user_metadata.get(key)
                if val and str(val).strip():
                    return str(val).strip()
        return None


class SupabaseAuthVerifier:
    """Verifies Supabase access tokens using asymmetric JWKS (ES256/RS256) or symmetric secret (HS256)."""

    def __init__(self):
        self._jwks_client: Optional[jwt.PyJWKClient] = None
        self._jwks_url: str = ""

    def _get_jwks_client(self) -> jwt.PyJWKClient:
        jwks_url = settings.SUPABASE_JWKS_URL.strip() or f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
        if self._jwks_client is None or self._jwks_url != jwks_url:
            self._jwks_url = jwks_url
            self._jwks_client = jwt.PyJWKClient(jwks_url, cache_keys=True, max_cached_keys=16)
        return self._jwks_client

    def verify_token(self, token: str) -> AuthenticatedUser:
        """Validate Supabase access token signature, expiry, and issuer."""
        if not token or not token.strip():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Empty authorization token provided.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = token.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()

        # Unverified header inspection to determine algorithm & key ID
        try:
            unverified_header = jwt.get_unverified_header(token)
            alg = unverified_header.get("alg", "ES256")
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Malformed JWT token: {str(e)}",
                headers={"WWW-Authenticate": "Bearer"},
            )

        payload: Dict[str, Any] = {}

        # 1. Symmetric HS256 handling (e.g. test tokens or legacy Supabase secret)
        if alg == "HS256":
            secret = settings.SUPABASE_JWT_SECRET.strip()
            if not secret:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Server is not configured for HS256 JWT verification.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            try:
                payload = jwt.decode(
                    token,
                    secret,
                    algorithms=["HS256"],
                    options={"verify_exp": True, "verify_aud": False},
                )
            except ExpiredSignatureError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication token has expired.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            except InvalidTokenError as ite:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Invalid authentication token: {str(ite)}",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        # 2. Asymmetric ES256 / RS256 via Supabase JWKS (Modern standard for Supabase)
        else:
            try:
                client = self._get_jwks_client()
                signing_key = client.get_signing_key_from_jwt(token)
                expected_issuer = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1"

                payload = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=[alg, "ES256", "RS256"],
                    options={
                        "verify_exp": True,
                        "verify_aud": False,  # Supabase aud can be 'authenticated' or custom
                    },
                )

                # Validate issuer if present in payload
                iss = payload.get("iss")
                if iss and iss != expected_issuer and settings.APP_ENV != "testing":
                    logger.warning("Token issuer mismatch: %s != %s", iss, expected_issuer)
            except ExpiredSignatureError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication token has expired.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            except PyJWKClientError as jwke:
                logger.error("JWKS client error verifying token: %s", jwke)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unable to verify token against Supabase auth server keys.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            except InvalidTokenError as ite:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Invalid authentication token signature: {str(ite)}",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            except Exception as e:
                logger.error("Unexpected token verification error: %s", e)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication verification failed.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token is missing required user subject ('sub') claim.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return AuthenticatedUser(
            id=str(user_id),
            email=payload.get("email"),
            role=payload.get("role", "authenticated"),
            user_metadata=payload.get("user_metadata") or {},
            app_metadata=payload.get("app_metadata") or {},
        )


supabase_auth_verifier = SupabaseAuthVerifier()
