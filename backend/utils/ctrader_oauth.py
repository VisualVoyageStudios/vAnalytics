import os
import httpx

CTRADER_CLIENT_ID     = os.getenv("CTRADER_CLIENT_ID")
CTRADER_CLIENT_SECRET = os.getenv("CTRADER_CLIENT_SECRET")
CTRADER_REDIRECT_URI  = "https://vanalytics.onrender-1.com/ctrader/callback"


def build_ctrader_auth_url(state: str) -> str:
    return (
        "https://connect.spotware.com/apps/auth"
        f"?client_id={CTRADER_CLIENT_ID}"
        f"&redirect_uri={CTRADER_REDIRECT_URI}"
        "&scope=accounts"
        f"&state={state}"
    )


async def exchange_ctrader_code(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://connect.spotware.com/apps/token",
            data={
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  CTRADER_REDIRECT_URI,
                "client_id":     CTRADER_CLIENT_ID,
                "client_secret": CTRADER_CLIENT_SECRET,
            }
        )
    return res.json()

# NOTE: This handles the OAuth handshake only. Actual trade-history fetching
# on cTrader's Open API is a protobuf/TCP protocol, not REST — that piece
# needs the `ctrader-open-api` client once you've registered a Spotware app
# and confirmed your broker exposes Open API access. Flagging so this isn't
# mistaken for a complete sync.
