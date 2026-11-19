"""Test configuration, fixtures, and in-memory test database."""

import os
import sys
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Add backend directory to sys.path
backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.api.deps import get_db
from app.core.database import Base, engine
from app.core.security import SESSION_HEADER_NAME
from app.main import app
from app.models.session import AnonymousSession
from app.services.session_service import session_service

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

TestSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


@pytest.fixture(scope="session", autouse=True)
def setup_test_env():
    """Configure environment variables for testing."""
    os.environ["APP_ENV"] = "testing"
    os.environ["DEBUG"] = "true"


@pytest.fixture(autouse=True)
async def setup_database():
    """Create all tables before each test and drop them after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()
    await engine.dispose()


@pytest.fixture
async def db_session():
    """Provide an isolated database session for a test."""
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def client(db_session: AsyncSession):
    """Provide an HTTP test client with database dependency override."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def test_session(db_session: AsyncSession) -> AnonymousSession:
    """Create a persistent anonymous session for testing."""
    return await session_service.create_session(
        db=db_session,
        ip_address="127.0.0.1",
        user_agent="pytest-client",
    )


@pytest.fixture
def auth_headers(test_session: AnonymousSession) -> dict:
    """Return authorization headers with valid X-Session-Token."""
    return {SESSION_HEADER_NAME: test_session.session_token}

