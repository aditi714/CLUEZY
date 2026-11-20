"""Add user_id ownership column and nullable session_id to investigations.

Revision ID: 0002_add_user_id
Revises: 0001_initial_schema
Create Date: 2026-11-20 18:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0002_add_user_id"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add user_id column for Supabase authenticated user ownership
    op.add_column(
        "investigations",
        sa.Column("user_id", sa.String(64), nullable=True),
    )
    op.create_index("ix_investigations_user_id", "investigations", ["user_id"])

    # 2. Relax session_id constraint to allow nullable for purely authenticated investigations
    op.alter_column(
        "investigations",
        "session_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "investigations",
        "session_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=False,
    )
    op.drop_index("ix_investigations_user_id", table_name="investigations")
    op.drop_column("investigations", "user_id")
