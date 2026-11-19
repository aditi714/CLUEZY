"""FastAPI dependency injection utilities."""

from typing import Optional
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import SESSION_HEADER_NAME
from app.models.session import AnonymousSession
from app.services.session_service import session_service


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

