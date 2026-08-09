import httpx
import os
import hmac
import hashlib

PAYSTACK_BASE = "https://api.paystack.co"
LIFETIME_PRICE_ZAR = 1800.00  # set once you confirm the ZAR lifetime price — see note below
MONTHLY_PRICE_ZAR  = 360.00  # set once you confirm the ZAR monthly price


def _secret_key() -> str:
    return os.getenv("PAYSTACK_SECRET_KEY")


async def initialize_lifetime_payment(user_id: str, email: str) -> dict:
    """Starts a one-time Paystack transaction for the lifetime plan."""
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{PAYSTACK_BASE}/transaction/initialize",
            headers={"Authorization": f"Bearer {_secret_key()}", "Content-Type": "application/json"},
            json={
                "email": email,
                "amount": int(LIFETIME_PRICE_ZAR * 100),  # Paystack ZAR amounts are in cents
                "currency": "ZAR",
                "metadata": {"user_id": user_id, "plan": "lifetime"},
                "callback_url": "https://visualvoyagestudios.github.io/vAnalytics/dashboard/settings.html?payment=success"
            },
            timeout=15.0
        )
    res.raise_for_status()
    return res.json()["data"]


async def initialize_subscription(user_id: str, email: str) -> dict:
    """Starts a Paystack transaction tied to the monthly Plan code."""
    plan_code = os.getenv("PAYSTACK_MONTHLY_PLAN_CODE")

    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{PAYSTACK_BASE}/transaction/initialize",
            headers={"Authorization": f"Bearer {_secret_key()}", "Content-Type": "application/json"},
            json={
                "email": email,
                "amount": int(MONTHLY_PRICE_ZAR * 100),
                "currency": "ZAR",
                "plan": plan_code,
                "metadata": {"user_id": user_id, "plan": "monthly"},
                "callback_url": "https://visualvoyagestudios.github.io/vAnalytics/dashboard/settings.html?payment=success"
            },
            timeout=15.0
        )
    res.raise_for_status()
    return res.json()["data"]


async def verify_transaction(reference: str) -> dict:
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{PAYSTACK_BASE}/transaction/verify/{reference}",
            headers={"Authorization": f"Bearer {_secret_key()}"},
            timeout=15.0
        )
    res.raise_for_status()
    return res.json()["data"]


async def disable_subscription(subscription_code: str, email_token: str):
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{PAYSTACK_BASE}/subscription/disable",
            headers={"Authorization": f"Bearer {_secret_key()}", "Content-Type": "application/json"},
            json={"code": subscription_code, "token": email_token},
            timeout=15.0
        )


async def refund_transaction(transaction_reference: str, amount_zar: float):
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{PAYSTACK_BASE}/refund",
            headers={"Authorization": f"Bearer {_secret_key()}", "Content-Type": "application/json"},
            json={
                "transaction": transaction_reference,
                "amount": int(amount_zar * 100)
            },
            timeout=15.0
        )


def verify_paystack_signature(body_bytes: bytes, signature_header: str) -> bool:
    secret = _secret_key()
    if not secret:
        return False
    computed = hmac.new(secret.encode(), body_bytes, hashlib.sha512).hexdigest()
    return hmac.compare_digest(computed, signature_header or "")
