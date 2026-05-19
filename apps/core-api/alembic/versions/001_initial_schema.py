"""Initial schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-05-19 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001_initial_schema'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create users table
    op.create_table('users',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('user_id'),
        sa.UniqueConstraint('email')
    )
    op.create_index('idx_users_email', 'users', ['email'], unique=False)

    # Create events table
    op.create_table('events',
        sa.Column('event_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('location', sa.String(255), nullable=False),
        sa.Column('start_at', sa.DateTime(), nullable=False),
        sa.Column('end_at', sa.DateTime(), nullable=False),
        sa.Column('total_seats', sa.Integer(), nullable=False),
        sa.Column('available_seats', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('event_id')
    )
    op.create_index('idx_events_start_at', 'events', ['start_at'], unique=False)

    # Create seats table
    op.create_table('seats',
        sa.Column('seat_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('event_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('section', sa.String(50), nullable=False),
        sa.Column('row', sa.String(5), nullable=False),
        sa.Column('seat_number', sa.Integer(), nullable=False),
        sa.Column('status', sa.Enum('available', 'hold', 'sold', name='seat_status'), nullable=False),
        sa.Column('price', sa.Numeric(10, 2), nullable=False),
        sa.Column('held_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('held_until', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['events.event_id'], ),
        sa.PrimaryKeyConstraint('seat_id'),
        sa.UniqueConstraint('event_id', 'section', 'row', 'seat_number', name='uq_seats_event_section_row_number')
    )
    op.create_index('idx_seats_event_status', 'seats', ['event_id', 'status'], unique=False)
    op.create_index('idx_seats_held_until', 'seats', ['held_until'], unique=False)

    # Create reservations table
    op.create_table('reservations',
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('event_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('seat_ids', sa.JSON(), nullable=False),
        sa.Column('status', sa.Enum('held', 'completed', 'cancelled', name='reservation_status'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['event_id'], ['events.event_id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ),
        sa.PrimaryKeyConstraint('reservation_id')
    )
    op.create_index('idx_reservations_user_created', 'reservations', ['user_id', 'created_at'], unique=False)

    # Create payments table
    op.create_table('payments',
        sa.Column('payment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reservation_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('status', sa.Enum('pending', 'completed', 'failed', name='payment_status'), nullable=False),
        sa.Column('payment_method', sa.String(50), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['reservation_id'], ['reservations.reservation_id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ),
        sa.PrimaryKeyConstraint('payment_id')
    )
    op.create_index('idx_payments_reservation', 'payments', ['reservation_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_payments_reservation', table_name='payments')
    op.drop_table('payments')
    op.drop_index('idx_reservations_user_created', table_name='reservations')
    op.drop_table('reservations')
    op.drop_index('idx_seats_held_until', table_name='seats')
    op.drop_index('idx_seats_event_status', table_name='seats')
    op.drop_table('seats')
    op.drop_index('idx_events_start_at', table_name='events')
    op.drop_table('events')
    op.drop_index('idx_users_email', table_name='users')
    op.drop_table('users')
