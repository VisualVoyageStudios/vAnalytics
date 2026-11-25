import httpx
from datetime import date, timedelta

from utils.cftc_fetcher import (
    LEGACY_URL,
    DISAGGREGATED_URL,
    TFF_URL,
    CONTRACT_MAP_FOREX,
    CONTRACT_MAP_METALS,
    CONTRACT_MAP_CRYPTO,
    _parse_legacy,
    _parse_disaggregated,
    _parse_tff,
)


def backfill_cot_history():
    """
    One-time (or occasional) backfill: pulls the last 52 weeks from each
    CFTC Socrata endpoint (forex, metals, crypto) rather than a single
    week, so percentile ranking and sparklines are meaningful immediately.
    """
    cutoff = (date.today() - timedelta(weeks=52)).isoformat()
    rows   = []
    seen   = set()

    with httpx.Client(timeout=30.0) as client:

        # ── Forex — Legacy Futures Only ──────────────────────────────
        try:
            res = client.get(
                LEGACY_URL,
                params={
                    "$where": f"report_date_as_yyyy_mm_dd >= '{cutoff}'",
                    "$limit": "5000",
                    "$order": "report_date_as_yyyy_mm_dd DESC"
                }
            )
            res.raise_for_status()
            count = 0
            for entry in res.json():
                contract = entry.get("market_and_exchange_names", "").strip()
                ccy = CONTRACT_MAP_FOREX.get(contract)
                if not ccy:
                    continue
                row = _parse_legacy(entry, ccy, seen)
                if row:
                    rows.append(row)
                    count += 1
            print(f"Backfill forex: {count} rows", flush=True)
        except Exception as e:
            print(f"Backfill forex failed: {e}", flush=True)

        # ── Metals — Disaggregated Futures Only ──────────────────────
        try:
            res2 = client.get(
                DISAGGREGATED_URL,
                params={
                    "$where": f"report_date_as_yyyy_mm_dd >= '{cutoff}'",
                    "$limit": "5000",
                    "$order": "report_date_as_yyyy_mm_dd DESC"
                }
            )
            res2.raise_for_status()
            count = 0
            for entry in res2.json():
                contract = entry.get("market_and_exchange_names", "").strip()
                ccy = CONTRACT_MAP_METALS.get(contract)
                if not ccy:
                    continue
                row = _parse_disaggregated(entry, ccy, seen)
                if row:
                    rows.append(row)
                    count += 1
            print(f"Backfill metals: {count} rows", flush=True)
        except Exception as e:
            print(f"Backfill metals failed: {e}", flush=True)

        # ── Crypto — TFF Futures Only ─────────────────────────────────
        try:
            res3 = client.get(
                TFF_URL,
                params={
                    "$where": f"report_date_as_yyyy_mm_dd >= '{cutoff}'",
                    "$limit": "2000",
                    "$order": "report_date_as_yyyy_mm_dd DESC"
                }
            )
            res3.raise_for_status()
            count = 0
            for entry in res3.json():
                contract = entry.get("market_and_exchange_names", "").strip()
                ccy = CONTRACT_MAP_CRYPTO.get(contract)
                if not ccy:
                    continue
                row = _parse_tff(entry, ccy, seen)
                if row:
                    rows.append(row)
                    count += 1
            print(f"Backfill crypto: {count} rows", flush=True)
        except Exception as e:
            print(f"Backfill crypto failed: {e}", flush=True)

    print(f"Backfill total: {len(rows)} rows parsed", flush=True)
    return rows
