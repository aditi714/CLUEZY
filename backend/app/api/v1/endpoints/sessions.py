"""Anonymous session management API endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_session, get_db
from app.models.session import AnonymousSession
from app.schemas.common import APIResponse
from app.schemas.session import SessionCreateRequest, SessionResponse
from app.services.session_service import session_service

router = APIRouter()


@router.post(
    "",
    response_model=APIResponse[SessionResponse],
    summary="Create Anonymous Session",
    description="Initialize a new anonymous session allocating a daily token allowance for technical problem solving.",
)
async def create_session(
    request: Request,
    payload: Optional[SessionCreateRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    session = await session_service.create_session(
        db=db,
        request_data=payload,
        ip_address=client_ip,
        user_agent=user_agent,
    )

    response_data = SessionResponse(
        id=session.id,
        session_token=session.session_token,
        user_identifier=session.user_identifier,
        daily_token_limit=session.daily_token_limit,
        tokens_used=session.tokens_used,
        remaining_tokens=session.remaining_tokens,
        remaining_percentage=session.remaining_percentage,
        is_active=session.is_active,
        expires_at=session.expires_at,
        created_at=session.created_at,
    )

    return APIResponse(
        success=True,
        data=response_data,
        message="Anonymous session initialized successfully.",
    )


@router.get(
    "/me",
    response_model=APIResponse[SessionResponse],
    summary="Get Current Session Details",
    description="Retrieve token quota and status for the active anonymous session specified by X-Session-Token header.",
)
async def get_current_session_info(
    session: AnonymousSession = Depends(get_current_session),
):
    response_data = SessionResponse(
        id=session.id,
        session_token=session.session_token,
        user_identifier=session.user_identifier,
        daily_token_limit=session.daily_token_limit,
        tokens_used=session.tokens_used,
        remaining_tokens=session.remaining_tokens,
        remaining_percentage=session.remaining_percentage,
        is_active=session.is_active,
        expires_at=session.expires_at,
        created_at=session.created_at,
    )

    return APIResponse(
        success=True,
        data=response_data,
        message="Session active.",
    )

