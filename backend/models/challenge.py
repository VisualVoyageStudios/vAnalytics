from sqlalchemy import Column, String, Float, Boolean, DateTime, Integer
from datetime import datetime
from models.user import Base


class UserChallenge(Base):

    __tablename__ = "user_challenges"

    id          = Column(String, primary_key=True)
    user_id     = Column(String, nullable=False)
    week        = Column(String, nullable=False)  # format: YYYY-WNN
    rule_type   = Column(String, nullable=False)
    rule_value  = Column(Float, nullable=False)
    description = Column(String, nullable=False)
    achieved    = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
