import os
import httpx
from urllib.parse import urlencode

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI  = "https://vanalytics.onrender.com/auth/google/callback"

GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def build_google_auth_url() -> str:
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
        "prompt":        "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_google_code(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        token_res = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  GOOGLE_REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
        token_data = token_res.json()
        if "access_token" not in token_data:
            return {}

        userinfo_res = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"}
        )
        return userinfo_res.json()
