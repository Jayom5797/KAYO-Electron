"""add deployments and incidents tables

Revision ID: 002
Revises: 001
Create Date: 2026-03-12 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('deployments',
        sa.Column('deployment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('app_name', sa.String(255), nullable=False),
        sa.Column('git_repo', sa.String(500), nullable=False),
        sa.Column('git_branch', sa.String(255), nullable=False, server_default='main'),
        sa.Column('git_commit_sha', sa.String(40), nullable=True),
        sa.Column('k8s_namespace', sa.String(63), nullable=False),
        sa.Column('image_name', sa.String(500), nullable=True),
        sa.Column('status', sa.String(50), nullable=False, server_default='pending'),
        sa.Column('env_vars', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('build_logs', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deployed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.tenant_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('deployment_id')
    )
    op.create_index('ix_deployments_tenant_id', 'deployments', ['tenant_id'])

    op.create_table('incidents',
        sa.Column('incident_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='new'),
        sa.Column('attack_pattern', sa.String(100), nullable=True),
        sa.Column('mitre_technique', sa.String(20), nullable=True),
        sa.Column('root_event_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('event_chain', postgresql.ARRAY(postgresql.UUID(as_uuid=True)), nullable=True),
        sa.Column('graph_snapshot', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('ai_summary', sa.Text(), nullable=True),
        sa.Column('remediation_steps', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.tenant_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('incident_id')
    )
    op.create_index('ix_incidents_tenant_id', 'incidents', ['tenant_id'])
    op.create_index('ix_incidents_severity', 'incidents', ['severity'])
    op.create_index('ix_incidents_status', 'incidents', ['status'])
    op.create_index('ix_incidents_created_at', 'incidents', ['created_at'])


def downgrade():
    op.drop_table('incidents')
    op.drop_table('deployments')
