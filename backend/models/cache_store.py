from sqlalchemy import Column, String, Text, DateTime
from datetime import datetime
from database import Base

class CacheStore(Base):
    __tablename__ = "cache_store"

    key        = Column(String, primary_key=True)
    value      = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)
