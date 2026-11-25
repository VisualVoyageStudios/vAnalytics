from sqlalchemy import Column, String, DateTime, Boolean, Float
from sqlalchemy.orm import declarative_base
from datetime import datetime

Base = declarative_base()

class User(Base):

    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True)
    password_hash = Column(String)
    is_premium = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    subscription_type        = Column(String, default="free")
    total_paid                = Column(Float, default=0)
    ls_subscription_id        = Column(String, nullable=True)
    ls_customer_id             = Column(String, nullable=True)
    payment_provider           = Column(String, nullable=True)
    external_subscription_id   = Column(String, nullable=True)
    external_customer_id       = Column(String, nullable=True)

