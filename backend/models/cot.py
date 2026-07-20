from sqlalchemy import Column, Integer, String, Float, Date, DateTime
from datetime import datetime
from models.user import Base

class COTPosition(Base):
    __tablename__ = "cot_positions"

    id                = Column(Integer, primary_key=True, index=True)
    currency          = Column(String, nullable=False, index=True)   # EUR, GBP, JPY, AUD, CAD, CHF, NZD
    report_date       = Column(Date, nullable=False, index=True)     # CFTC "as of" Tuesday date

    large_spec_long   = Column(Integer, nullable=False)
    large_spec_short  = Column(Integer, nullable=False)
    commercial_long   = Column(Integer, nullable=False)
    commercial_short  = Column(Integer, nullable=False)
    small_spec_long   = Column(Integer, nullable=False)
    small_spec_short  = Column(Integer, nullable=False)

    net_position      = Column(Integer, nullable=False)   # large_spec_long - large_spec_short
    open_interest     = Column(Integer, nullable=False)

    fetched_at        = Column(DateTime, default=datetime.utcnow)
