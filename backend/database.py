import os
import re
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./voyager.db").strip()

# Neon's copy button sometimes gives:  psql 'postgresql://...'
if DATABASE_URL.startswith("psql "):
    DATABASE_URL = DATABASE_URL[5:]
DATABASE_URL = DATABASE_URL.strip().strip("'\"")

# Always use psycopg2 (what requirements.txt installs), whatever scheme was pasted:
# postgres://, postgresql://, postgresql+psycopg://  ->  postgresql+psycopg2://
DATABASE_URL = re.sub(r"^(postgres|postgresql)(\+\w+)?://", "postgresql+psycopg2://", DATABASE_URL)

# Password-safe line so you can confirm in the Render logs which DB it connected to
print("DB:", make_url(DATABASE_URL).render_as_string(hide_password=True), flush=True)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
