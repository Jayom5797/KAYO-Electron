"""add title, description, notes to incidents

Revision ID: 005
Revises: 004
Create Date: 2026-04-08 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('incidents', sa.Column('title', sa.String(255), nullable=True))
    op.add_column('incidents', sa.Column('description', sa.Text(), nullable=True))
    op.add_column('incidents', sa.Column('notes', postgresql.JSON(astext_type=sa.Text()), nullable=True))


def downgrade():
    op.drop_column('incidents', 'notes')
    op.drop_column('incidents', 'description')
    op.drop_column('incidents', 'title')
