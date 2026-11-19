"""Session business logic service."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import RateLimitExceededException, SessionNotFoundOrExpiredException
from app.core.security import generate_session_token, hash_ip
from app.models.session import AnonymousSession
from app.schemas.session import SessionCreateRequest


class SessionService:
    """Handles lifecycle, token limits, and validation for anonymous sessions."""

    async def create_session(
        self,
        db: AsyncSession,
        request_data: Optional[SessionCreateRequest] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> AnonymousSession:
        """Create a new anonymous session with a 30-day lifespan and token allocation."""
        expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.ANONYMOUS_SESSION_TTL_HOURS)
        token = generate_session_token()
        user_id = request_data.user_identifier if request_data and request_data.user_identifier else "Anonymous Explorer"

        session = AnonymousSession(
            session_token=token,
            user_identifier=user_id,
            daily_token_limit=settings.DAILY_TOKEN_LIMIT,
            tokens_used=0,
            is_active=True,
            ip_hash=hash_ip(ip_address),
            user_agent=user_agent[:255] if user_agent else None,
            expires_at=expires_at,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session

    async def get_by_token(
        self,
        db: AsyncSession,
        session_token: str,
    ) -> AnonymousSession:
        """Retrieve and validate an active anonymous session by token."""
        stmt = select(AnonymousSession).where(
            AnonymousSession.session_token == session_token,
            AnonymousSession.is_active.is_(True),
        )
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()

        if not session:
            raise SessionNotFoundOrExpiredException("Session token is invalid or does not exist.")

        # Check expiration safely handling SQLite naive datetimes
        now = datetime.now(timezone.utc)
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            session.is_active = False
            await db.commit()
            raise SessionNotFoundOrExpiredException("Session has expired. Please start a new session.")

        return session

    async def consume_tokens(
        self,
        db: AsyncSession,
        session: AnonymousSession,
        amount: int,
    ) -> AnonymousSession:
        """Record token consumption and enforce daily token limit."""
        if session.tokens_used + amount > session.daily_token_limit:
            raise RateLimitExceededException(
                f"Daily limit of {session.daily_token_limit} tokens reached. Remaining: {session.remaining_tokens}."
            )

        session.tokens_used += amount
        await db.commit()
        await db.refresh(session)
        return session


session_service = SessionService()
