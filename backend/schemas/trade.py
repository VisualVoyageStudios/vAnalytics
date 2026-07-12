from pydantic import BaseModel
from typing import Optional


class TradeCreate(BaseModel):

    account_id: str

    symbol: str

    order_type: str

    lot_size: float

    open_price: float

    close_price: float

    profit: float

    stop_loss: Optional[float] = None

    take_profit: Optional[float] = None
