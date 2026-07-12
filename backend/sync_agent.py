import requests
import MetaTrader5 as mt5
from datetime import datetime, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://voyageranalytics.netlify.app",
        "https://visualvoyagestudios.github.io",
        "https://visualvoyagestudios.github.io/vanalytics",
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    allow_methods=["*"],
    allow_headers=["*"]
)

API_URL = "https://vanalytics.onrender.com"


@app.get("/status")
def status():
    return {"status": "running"}


def _build_sl_tp_map(from_date, to_date):
    """
    Deals don't carry stop loss / take profit — those live on orders.
    Build a position_id -> (sl, tp) map from order history, keeping the
    last non-zero value seen per position (handles trailing stops).
    """
    orders = mt5.history_orders_get(from_date, to_date)
    sl_tp_map = {}

    if orders is None:
        return sl_tp_map

    for order in sorted(orders, key=lambda o: o.time_setup):
        pos_id = order.position_id
        if pos_id not in sl_tp_map:
            sl_tp_map[pos_id] = {"sl": None, "tp": None}

        if order.sl:
            sl_tp_map[pos_id]["sl"] = order.sl
        if order.tp:
            sl_tp_map[pos_id]["tp"] = order.tp

    return sl_tp_map


@app.post("/sync")
def sync(payload: dict):
    token = payload.get("token")

    if not token:
        return {"status": "error", "message": "No token provided"}

    # Connect to MT5
    if not mt5.initialize():
        return {
            "status": "error",
            "message": "MetaTrader 5 is not open. Please open MT5 on your computer and try again."
        }

    from_date = datetime.now() - timedelta(days=3652)
    to_date   = datetime.now()

    deals = mt5.history_deals_get(from_date, to_date)

    if deals is None:
        mt5.shutdown()
        return {"status": "error", "message": "No trade history found in MT5."}

    sl_tp_map = _build_sl_tp_map(from_date, to_date)

    trades = []
    for deal in deals:
        if deal.entry != mt5.DEAL_ENTRY_OUT:
            continue

        sl_tp = sl_tp_map.get(deal.position_id, {"sl": None, "tp": None})

        trades.append({
            "ticket":      str(deal.ticket),
            "symbol":      deal.symbol,
            "order_type":  str(deal.type),
            "lot_size":    deal.volume,
            "open_price":  deal.price,
            "close_price": deal.price,
            "profit":      deal.profit,
            "time":        deal.time,
            "stop_loss":   sl_tp["sl"],
            "take_profit": sl_tp["tp"]
        })

    mt5.shutdown()

    if not trades:
        return {"status": "success", "imported": 0}

    # Push to live backend
    res = requests.post(
        f"{API_URL}/trades/import",
        json=trades,
        headers={"Authorization": f"Bearer {token}"}
    )

    print(f"Status: {res.status_code}")
    print(f"Raw Response: {res.text}")

    try:
        return res.json()
    except ValueError:
        return {
            "status": "error",
            "message": f"Backend returned non-JSON (status {res.status_code})",
            "raw": res.text
        }


if __name__ == "__main__":
    print("Voyager Sync Agent running...")
    print("You can now use the Sync button on the Voyager Analytics website.")
    uvicorn.run(app, host="127.0.0.1", port=5001)
