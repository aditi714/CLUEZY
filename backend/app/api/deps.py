"""FastAPI dependency injection utilities for authentication and anonymous sessions."""

import uuid
from dataclasses import dataclass
from typing import Optional
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthenticatedUser, supabase_auth_verifier
from app.core.database import get_db
from app.core.security import SESSION_HEADER_NAME
from app.models.investigation import Investigation
from app.models.session import AnonymousSession
from app.services.session_service import session_service


async def get_optional_user(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> Optional[AuthenticatedUser]:
    """Dependency that extracts and validates a Supabase Bearer token if present."""
    if not authorization or not authorization.strip():
        return None
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        return None
    try:
        return supabase_auth_verifier.verify_token(token)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or unverifiable authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    user: Optional[AuthenticatedUser] = Depends(get_optional_user),
) -> AuthenticatedUser:
    """Dependency that strictly requires an authenticated Supabase user."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in with Google / Supabase.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_current_session(
    x_session_token: Optional[str] = Header(None, alias=SESSION_HEADER_NAME),
    db: AsyncSession = Depends(get_db),
) -> AnonymousSession:
    """Dependency that requires a valid active anonymous session via X-Session-Token header."""
    if not x_session_token or not x_session_token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Missing '{SESSION_HEADER_NAME}' header. Start a session via POST /api/v1/sessions.",
        )
    return await session_service.get_by_token(db, x_session_token.strip())


async def get_optional_session(
    x_session_token: Optional[str] = Header(None, alias=SESSION_HEADER_NAME),
    db: AsyncSession = Depends(get_db),
) -> Optional[AnonymousSession]:
    """Dependency that returns the anonymous session if present, or None."""
    if not x_session_token or not x_session_token.strip():
        return None
    try:
        return await session_service.get_by_token(db, x_session_token.strip())
    except Exception:
        return None


@dataclass
class TroubleshooterIdentity:
    """Unified caller identity supporting both authenticated Supabase accounts and anonymous sessions."""

    user: Optional[AuthenticatedUser] = None
    session: Optional[AnonymousSession] = None

    @property
    def is_authenticated(self) -> bool:
        return self.user is not None

    @property
    def user_id(self) -> Optional[str]:
        return self.user.id if self.user else None

    @property
    def session_id(self) -> Optional[uuid.UUID]:
        return self.session.id if self.session else None

    def can_access(self, investigation: Investigation) -> bool:
        """Centralized authorization check for investigation records."""
        # 1. If investigation is claimed or owned by an authenticated user
        if investigation.user_id:
            return self.user is not None and self.user.id == investigation.user_id

        # 2. If investigation is anonymous, only the owner session has access
        if investigation.session_id:
            return self.session is not None and self.session.id == investigation.session_id

        return False


async def get_troubleshooter_identity(
    user: Optional[AuthenticatedUser] = Depends(get_optional_user),
    session: Optional[AnonymousSession] = Depends(get_optional_session),
) -> TroubleshooterIdentity:
    """Dependency providing caller identity (authenticated user and/or anonymous session)."""
    return TroubleshooterIdentity(user=user, session=session)


async def require_troubleshooter_identity(
    identity: TroubleshooterIdentity = Depends(get_troubleshooter_identity),
) -> TroubleshooterIdentity:
    """Dependency ensuring caller provides either an authenticated bearer token or valid anonymous session."""
    if not identity.user and not identity.session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token or X-Session-Token header.",
        )
    return identity
