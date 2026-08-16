"""One-time script to seed a default admin user and tenant."""
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://kayo:kayo_dev_password@127.0.0.1:5433/kayo_control_plane")

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)
db = Session()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

try:
    from models.tenant import Tenant
    from models.user import User

    # Create tenant
    tenant = Tenant(
        tenant_id=uuid.uuid4(),
        name="Default Org",
        slug="default-org",
        tier="pro",
        settings={}
    )
    db.add(tenant)
    db.flush()

    # Create admin user
    user = User(
        user_id=uuid.uuid4(),
        tenant_id=tenant.tenant_id,
        email="vikastiwari1045@gmail.com",
        password_hash=pwd_context.hash("Vikas123"),
        role="admin"
    )
    db.add(user)
    db.commit()
    print(f"Created tenant: {tenant.tenant_id}")
    print(f"Created user: {user.email} (role: {user.role})")
except Exception as e:
    db.rollback()
    print(f"Error: {e}")
finally:
    db.close()
