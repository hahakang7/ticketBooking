"""Add reservation status_expires index

Revision ID: 002_add_reservation_index
Revises: 001_initial_schema
Create Date: 2026-06-12 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '002_add_reservation_index'
down_revision = '001_initial_schema'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index('idx_reservations_status_expires', 'reservations', ['status', 'expires_at'])


def downgrade() -> None:
    op.drop_index('idx_reservations_status_expires', table_name='reservations')
