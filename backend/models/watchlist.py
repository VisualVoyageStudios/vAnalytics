from sqlalchemy import Column, String, DateTime
from datetime import datetime
from models.user import Base

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id         = Column(String, primary_key=True)
    user_id    = Column(String, nullable=False, index=True)
    symbol     = Column(String, nullable=False)
    category   = Column(String, nullable=False, default="forex")
    label      = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
