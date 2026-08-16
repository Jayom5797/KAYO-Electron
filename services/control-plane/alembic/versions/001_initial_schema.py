"""initial schema

Revision ID: 001
Revises: 
Create Date: 2026-03-12 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('tenants',
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('slug', sa.String(63), nullable=False),
        sa.Column('tier', sa.String(50), nullable=False, server_default='free'),
        sa.Column('settings', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('tenant_id')
    )
    op.create_index('ix_tenants_slug', 'tenants', ['slug'], unique=True)
    op.create_index('ix_tenants_tier', 'tenants', ['tier'])

    op.create_table('tenant_quotas',
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('max_deployments', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('max_cpu_cores', sa.Integer(), nullable=False, server_default='2'),
        sa.Column('max_memory_gb', sa.Integer(), nullable=False, server_default='4'),
        sa.Column('max_storage_gb', sa.Integer(), nullable=False, server_default='10'),
        sa.Column('event_retention_days', sa.Integer(), nullable=False, server_default='7'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.tenant_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('tenant_id')
    )

    op.create_table('tenant_subscriptions',
        sa.Column('subscription_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tier', sa.String(50), nullable=False),
        sa.Column('status', sa.String(50), nullable=False, server_default='active'),
        sa.Column('billing_cycle', sa.String(20), nullable=False, server_default='monthly'),
        sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.tenant_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('subscription_id')
    )

    op.create_table('tenant_usage',
        sa.Column('usage_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('events_ingested', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('storage_gb', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('compute_hours', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('graph_queries', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('ai_tokens', sa.BigInteger(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.tenant_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('usage_id')
    )
    op.create_index('ix_tenant_usage_tenant_id', 'tenant_usage', ['tenant_id'])
    op.create_index('ix_tenant_usage_date', 'tenant_usage', ['date'])

    op.create_table('users',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('role', sa.String(50), nullable=False, server_default='member'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.tenant_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id')
    )
    op.create_index('ix_users_tenant_id', 'users', ['tenant_id'])
    op.create_index('ix_users_email', 'users', ['email'], unique=True)


def downgrade():
    op.drop_table('users')
    op.drop_table('tenant_usage')
    op.drop_table('tenant_subscriptions')
    op.drop_table('tenant_quotas')
    op.drop_table('tenants')
