import json
import time
import websockets
from fastapi import HTTPException

DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089"
# NOTE: app_id=1089 is Deriv's shared public demo app id — fine for testing,
# but register your own free app_id at api.deriv.com before real users rely
# on this, since the shared id is rate-limited across everyone using it.


async def fetch_deriv_trades(api_token: str) -> list:
    async with websockets.connect(DERIV_WS_URL) as ws:
        await ws.send(json.dumps({"authorize": api_token}))
        auth_res = json.loads(await ws.recv())

        if auth_res.get("error"):
            raise HTTPException(status_code=400, detail=f"Deriv auth failed: {auth_res['error']['message']}")

        await ws.send(json.dumps({"profit_table": 1, "limit": 200, "sort": "DESC"}))
        trades_res = json.loads(await ws.recv())

        if trades_res.get("error"):
            raise HTTPException(status_code=400, detail=f"Deriv fetch failed: {trades_res['error']['message']}")

        return trades_res.get("profit_table", {}).get("transactions", [])
