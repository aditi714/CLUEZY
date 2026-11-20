"""Investigation API endpoints with dual authenticated user and anonymous session support."""

from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_user,
    get_db,
    require_troubleshooter_identity,
    TroubleshooterIdentity,
)
from app.core.auth import AuthenticatedUser
from app.schemas.action import RecommendedActionItem
from app.schemas.candidate_cause import CandidateCauseItem
from app.schemas.common import APIResponse, PaginatedResponse
from app.schemas.evidence import EvidenceItem
from app.schemas.investigation import (
    ClaimAnonymousRequest,
    ClaimAnonymousResponse,
    InvestigationCreateRequest,
    InvestigationDetailResponse,
    InvestigationListItem,
    InvestigationProgressRequest,
    InvestigationResolveRequest,
)
from app.schemas.message import MessageResponse
from app.schemas.report import ReportResponse
from app.services.investigation_service import investigation_service

router = APIRouter()


def _to_detail_response(inv) -> InvestigationDetailResponse:
    """Helper to convert Investigation ORM model to InvestigationDetailResponse schema."""
    return InvestigationDetailResponse(
        id=inv.id,
        reference_id=inv.reference_id,
        user_id=inv.user_id,
        session_id=inv.session_id,
        title=inv.title,
        problem_description=inv.problem_description,
        device_type=inv.device_type,
        os_info=inv.os_info,
        network_info=inv.network_info,
        status=inv.status,
        category=inv.category,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
        resolved_at=inv.resolved_at,
        messages=[MessageResponse.model_validate(m) for m in inv.messages],
        evidence=[EvidenceItem.model_validate(e) for e in inv.evidence],
        candidate_causes=[CandidateCauseItem.model_validate(c) for c in inv.candidate_causes],
        recommended_actions=[RecommendedActionItem.model_validate(a) for a in inv.recommended_actions],
        report=ReportResponse.model_validate(inv.report) if inv.report else None,
    )


@router.post(
    "",
    response_model=APIResponse[InvestigationDetailResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Create Investigation",
    description="Initiate a new troubleshooting investigation. Automatically parses problem description, sets up triage evidence, and prompts initial diagnostic check.",
)
async def create_investigation(
    payload: InvestigationCreateRequest,
    identity: TroubleshooterIdentity = Depends(require_troubleshooter_identity),
    db: AsyncSession = Depends(get_db),
):
    investigation = await investigation_service.create_investigation(
        db=db,
        session_id=identity.session_id,
        user_id=identity.user_id,
        request=payload,
    )

    return APIResponse(
        success=True,
        data=_to_detail_response(investigation),
        message=f"Investigation {investigation.reference_id} created successfully.",
    )


@router.get(
    "",
    response_model=APIResponse[PaginatedResponse[InvestigationListItem]],
    summary="List Investigations",
    description="Retrieve past troubleshooting sessions associated with the current user account or anonymous session.",
)
async def list_investigations(
    status: Optional[str] = Query(None, description="Filter by status (e.g. active, in_progress, resolved)"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    identity: TroubleshooterIdentity = Depends(require_troubleshooter_identity),
    db: AsyncSession = Depends(get_db),
):
    items, total = await investigation_service.list_investigations(
        db=db,
        session_id=identity.session_id,
        user_id=identity.user_id,
        status=status,
        page=page,
        page_size=page_size,
    )

    pydantic_items = [InvestigationListItem(**item) for item in items]
    has_more = (page * page_size) < total

    return APIResponse(
        success=True,
        data=PaginatedResponse(
            items=pydantic_items,
            total=total,
            page=page,
            page_size=page_size,
            has_more=has_more,
        ),
    )


@router.post(
    "/claim-anonymous",
    response_model=APIResponse[ClaimAnonymousResponse],
    summary="Claim Anonymous Investigations",
    description="Safely associate previous anonymous investigations created under the given session token with the authenticated user account.",
)
async def claim_anonymous_investigations(
    payload: ClaimAnonymousRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count, refs = await investigation_service.claim_anonymous_investigations(
        db=db,
        user_id=current_user.id,
        session_token=payload.session_token,
    )

    return APIResponse(
        success=True,
        data=ClaimAnonymousResponse(
            claimed_count=count,
            reference_ids=refs,
            message=f"Successfully associated {count} anonymous investigation(s) with account {current_user.id}.",
        ),
        message="Account linking completed successfully.",
    )


@router.get(
    "/{identifier}",
    response_model=APIResponse[InvestigationDetailResponse],
    summary="Get Investigation Details",
    description="Fetch complete investigation details, chat history, facts ('What we know'), candidate causes, and actions by UUID or reference ID (e.g. INV-2387).",
)
async def get_investigation(
    identifier: str,
    identity: TroubleshooterIdentity = Depends(require_troubleshooter_identity),
    db: AsyncSession = Depends(get_db),
):
    investigation = await investigation_service.get_investigation(
        db=db,
        session_id=identity.session_id,
        user_id=identity.user_id,
        identifier=identifier,
    )

    return APIResponse(
        success=True,
        data=_to_detail_response(investigation),
    )


@router.post(
    "/{identifier}/progress",
    response_model=APIResponse[InvestigationDetailResponse],
    summary="Progress Investigation State",
    description="Submit an answer to a diagnostic question or outcome of a recommended action. Re-evaluates diagnostic rules, updates candidate cause scores, and determines the next question or fix step.",
)
async def progress_investigation(
    identifier: str,
    payload: InvestigationProgressRequest,
    identity: TroubleshooterIdentity = Depends(require_troubleshooter_identity),
    db: AsyncSession = Depends(get_db),
):
    investigation = await investigation_service.progress_investigation(
        db=db,
        session_id=identity.session_id,
        user_id=identity.user_id,
        identifier=identifier,
        request=payload,
    )

    return APIResponse(
        success=True,
        data=_to_detail_response(investigation),
        message="Investigation progressed successfully.",
    )


@router.post(
    "/{identifier}/resolve",
    response_model=APIResponse[InvestigationDetailResponse],
    summary="Resolve Investigation",
    description="Explicitly mark the investigation as resolved upon user confirmation and generate the final post-mortem report.",
)
async def resolve_investigation(
    identifier: str,
    payload: Optional[InvestigationResolveRequest] = None,
    identity: TroubleshooterIdentity = Depends(require_troubleshooter_identity),
    db: AsyncSession = Depends(get_db),
):
    notes = payload.user_notes if payload else None
    investigation = await investigation_service.resolve_investigation(
        db=db,
        session_id=identity.session_id,
        user_id=identity.user_id,
        identifier=identifier,
        user_notes=notes,
    )

    return APIResponse(
        success=True,
        data=_to_detail_response(investigation),
        message="Investigation marked as resolved and report generated.",
    )
