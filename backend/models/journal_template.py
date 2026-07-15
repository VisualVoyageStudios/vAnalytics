from sqlalchemy import Column, String, DateTime
from datetime import datetime
from models.user import Base


class JournalTemplate(Base):

    __tablename__ = "journal_templates"

    id         = Column(String, primary_key=True)
    user_id    = Column(String, nullable=False)
    field      = Column(String, nullable=False)  # "lesson" or "mistake"
    text       = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
