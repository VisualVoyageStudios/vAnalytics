from sqlalchemy import Column, String, DateTime
from datetime import datetime
from models.user import Base

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id         = Column(String, primary_key=True)
    user_id    = Column(String, nullable=False)
    symbol     = Column(String, nullable=False)  # e.g. "EURUSD", "XAUUSD", "AAPL"
    label      = Column(String, nullable=True)   # optional display name
    category   = Column(String, default="forex") # forex, metals, crypto, stocks
    created_at = Column(DateTime, default=datetime.utcnow)
  
  try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS watchlist_items (
                id VARCHAR PRIMARY KEY,
                user_id VARCHAR NOT NULL,
                symbol VARCHAR NOT NULL,
                label VARCHAR,
                category VARCHAR DEFAULT 'forex',
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"watchlist_items migration skipped: {e}")
