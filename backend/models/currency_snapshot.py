from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime

from models.user import Base


class CurrencySnapshot(Base):

    __tablename__ = "currency_snapshots"

    id        = Column(String, primary_key=True)
    rates     = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
