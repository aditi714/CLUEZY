"""Initial database schema with 12 foundational models.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-11-18 19:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Anonymous Sessions
    op.create_table(
        "anonymous_sessions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("session_token", sa.String(64), nullable=False, unique=True),
        sa.Column("user_identifier", sa.String(100), nullable=True),
        sa.Column("daily_token_limit", sa.Integer(), nullable=False, server_default="200000"),
        sa.Column("tokens_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("ip_hash", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_anonymous_sessions_session_token", "anonymous_sessions", ["session_token"])

    # 2. Knowledge Categories
    op.create_table(
        "knowledge_categories",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_knowledge_categories_slug", "knowledge_categories", ["slug"])

    # 3. Diagnostic Causes
    op.create_table(
        "diagnostic_causes",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), sa.ForeignKey("knowledge_categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("typical_symptoms", sa.JSON(), nullable=True),
        sa.Column("severity", sa.String(20), nullable=False, server_default="Medium"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_diagnostic_causes_category_id", "diagnostic_causes", ["category_id"])
    op.create_index("ix_diagnostic_causes_slug", "diagnostic_causes", ["slug"])

    # 4. Diagnostic Questions
    op.create_table(
        "diagnostic_questions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("cause_id", sa.Uuid(as_uuid=True), sa.ForeignKey("diagnostic_causes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category_id", sa.Uuid(as_uuid=True), sa.ForeignKey("knowledge_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("expected_type", sa.String(30), nullable=False, server_default="choice"),
        sa.Column("options", sa.JSON(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_diagnostic_questions_cause_id", "diagnostic_questions", ["cause_id"])
    op.create_index("ix_diagnostic_questions_category_id", "diagnostic_questions", ["category_id"])

    # 5. Diagnostic Rules
    op.create_table(
        "diagnostic_rules",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("condition", sa.JSON(), nullable=False),
        sa.Column("action", sa.JSON(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 6. Investigations
    op.create_table(
        "investigations",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("reference_id", sa.String(20), nullable=False, unique=True),
        sa.Column("session_id", sa.Uuid(as_uuid=True), sa.ForeignKey("anonymous_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("problem_description", sa.Text(), nullable=False),
        sa.Column("device_type", sa.String(100), nullable=True),
        sa.Column("os_info", sa.String(100), nullable=True),
        sa.Column("network_info", sa.String(100), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_investigations_reference_id", "investigations", ["reference_id"])
    op.create_index("ix_investigations_session_id", "investigations", ["session_id"])
    op.create_index("ix_investigations_status", "investigations", ["status"])

    # 7. Messages
    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("investigation_id", sa.Uuid(as_uuid=True), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("suggested_responses", sa.JSON(), nullable=True),
        sa.Column("extra_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_messages_investigation_id", "messages", ["investigation_id"])

    # 8. Evidence
    op.create_table(
        "evidence",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("investigation_id", sa.Uuid(as_uuid=True), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(50), nullable=False, server_default="general"),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("source", sa.String(50), nullable=False, server_default="user_stated"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_evidence_investigation_id", "evidence", ["investigation_id"])

    # 9. Candidate Causes
    op.create_table(
        "candidate_causes",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("investigation_id", sa.Uuid(as_uuid=True), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("diagnostic_cause_id", sa.Uuid(as_uuid=True), sa.ForeignKey("diagnostic_causes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("likelihood", sa.String(20), nullable=False, server_default="Medium"),
        sa.Column("status", sa.String(30), nullable=False, server_default="suspected"),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_candidate_causes_investigation_id", "candidate_causes", ["investigation_id"])

    # 10. Recommended Actions
    op.create_table(
        "recommended_actions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("investigation_id", sa.Uuid(as_uuid=True), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cause_id", sa.Uuid(as_uuid=True), sa.ForeignKey("diagnostic_causes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("step_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("total_steps", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("steps", sa.JSON(), nullable=True),
        sa.Column("expected_result", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_recommended_actions_investigation_id", "recommended_actions", ["investigation_id"])

    # 11. Action Outcomes
    op.create_table(
        "action_outcomes",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("recommended_action_id", sa.Uuid(as_uuid=True), sa.ForeignKey("recommended_actions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("investigation_id", sa.Uuid(as_uuid=True), sa.ForeignKey("investigations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("outcome", sa.String(30), nullable=False),
        sa.Column("user_feedback", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_action_outcomes_recommended_action_id", "action_outcomes", ["recommended_action_id"])
    op.create_index("ix_action_outcomes_investigation_id", "action_outcomes", ["investigation_id"])

    # 12. Reports
    op.create_table(
        "reports",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("investigation_id", sa.Uuid(as_uuid=True), sa.ForeignKey("investigations.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("root_cause", sa.Text(), nullable=False),
        sa.Column("fix_applied", sa.Text(), nullable=False),
        sa.Column("resolution_steps", sa.JSON(), nullable=True),
        sa.Column("preventative_measures", sa.JSON(), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reports_investigation_id", "reports", ["investigation_id"])


def downgrade() -> None:
    op.drop_table("reports")
    op.drop_table("action_outcomes")
    op.drop_table("recommended_actions")
    op.drop_table("candidate_causes")
    op.drop_table("evidence")
    op.drop_table("messages")
    op.drop_table("investigations")
    op.drop_table("diagnostic_rules")
    op.drop_table("diagnostic_questions")
    op.drop_table("diagnostic_causes")
    op.drop_table("knowledge_categories")
    op.drop_table("anonymous_sessions")

