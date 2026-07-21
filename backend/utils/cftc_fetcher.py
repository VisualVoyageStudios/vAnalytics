import requests
import csv
import io
from datetime import date, timedelta

CFTC_URL = "https://www.cftc.gov/dea/newcot/FinFutWk.txt"

# CFTC contract names (verified against a real pulled file) → our currency codes
# In cftc_fetcher.py — expand CONTRACT_MAP
CONTRACT_MAP_FOREX = {
    "EURO FX - CHICAGO MERCANTILE EXCHANGE":               "EUR",
    "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE":"GBP",
    "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE":          "JPY",
    "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE":     "AUD",
    "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE":       "CAD",
    "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE":           "CHF",
    "NEW ZEALAND DOLLAR - CHICAGO MERCANTILE EXCHANGE":    "NZD",
    "GOLD - COMMODITY EXCHANGE INC.":                      "XAU",
    "SILVER - COMMODITY EXCHANGE INC.":                    "XAG",
    "PLATINUM - NEW YORK MERCANTILE EXCHANGE":             "XPT",
    "COPPER- #1 - COMMODITY EXCHANGE INC.":                "XCU",
}

CONTRACT_MAP_FINANCIAL = {
    "BITCOIN - CHICAGO MERCANTILE EXCHANGE":               "BTC",
    "ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE":    "ETH",
}

# XRP has no CFTC futures — skip it


def fetch_latest_cot() -> list:
    import httpx

    cutoff = (date.today() - timedelta(weeks=2)).isoformat()
    rows   = []
    seen   = set()

    with httpx.Client(timeout=30.0) as client:

        # ── Legacy futures (forex + metals) ──────────────────────────
        res = client.get(
            "https://publicreporting.cftc.gov/resource/6dca-aqww.json",
            params={
                "$where": f"report_date_as_yyyy_mm_dd >= '{cutoff}'",
                "$limit": "100",
                "$order": "report_date_as_yyyy_mm_dd DESC"
            }
        )
        res.raise_for_status()

        for entry in res.json():
            contract = entry.get("market_and_exchange_names", "").strip()
            ccy      = CONTRACT_MAP_FOREX.get(contract)
            if not ccy:
                continue
            row = _parse_cot_entry(entry, ccy, seen)
            if row:
                rows.append(row)

        # ── Financial futures (crypto) ────────────────────────────────
        res2 = client.get(
            "https://publicreporting.cftc.gov/resource/yw9f-hn96.json",
            params={
                "$where": f"report_date_as_yyyy_mm_dd >= '{cutoff}'",
                "$limit": "50",
                "$order": "report_date_as_yyyy_mm_dd DESC"
            }
        )
        res2.raise_for_status()

        for entry in res2.json():
            contract = entry.get("market_and_exchange_names", "").strip()
            ccy      = CONTRACT_MAP_FINANCIAL.get(contract)
            if not ccy:
                continue
            row = _parse_cot_entry(entry, ccy, seen)
            if row:
                rows.append(row)

    print(f"COT fetcher: {len(rows)} rows parsed (forex + metals + crypto)", flush=True)
    return rows


def _parse_cot_entry(entry: dict, ccy: str, seen: set):
    """Parse a single CFTC row into a standardised dict."""
    try:
        report_date = date.fromisoformat(
            entry["report_date_as_yyyy_mm_dd"][:10]
        )
    except (KeyError, ValueError):
        return None

    key = (ccy, report_date)
    if key in seen:
        return None
    seen.add(key)

    try:
        # Financial futures uses different field names
        long_field  = "noncomm_positions_long_all"  if "noncomm_positions_long_all"  in entry else "lev_money_positions_long_all"
        short_field = "noncomm_positions_short_all" if "noncomm_positions_short_all" in entry else "lev_money_positions_short_all"
        comm_long_f = "comm_positions_long_all"     if "comm_positions_long_all"     in entry else "asset_mgr_positions_long_all"
        comm_sht_f  = "comm_positions_short_all"    if "comm_positions_short_all"    in entry else "asset_mgr_positions_short_all"

        large_spec_long  = int(entry.get(long_field,  0) or 0)
        large_spec_short = int(entry.get(short_field, 0) or 0)
        commercial_long  = int(entry.get(comm_long_f, 0) or 0)
        commercial_short = int(entry.get(comm_sht_f,  0) or 0)
        open_interest    = int(entry.get("open_interest_all", 0) or 0)

        total_rep_long   = large_spec_long  + commercial_long
        total_rep_short  = large_spec_short + commercial_short
        small_spec_long  = max(0, open_interest - total_rep_long)
        small_spec_short = max(0, open_interest - total_rep_short)

        return {
            "currency":          ccy,
            "report_date":       report_date,
            "large_spec_long":   large_spec_long,
            "large_spec_short":  large_spec_short,
            "commercial_long":   commercial_long,
            "commercial_short":  commercial_short,
            "small_spec_long":   small_spec_long,
            "small_spec_short":  small_spec_short,
            "net_position":      large_spec_long - large_spec_short,
            "open_interest":     open_interest,
        }
    except (ValueError, TypeError) as e:
        print(f"COT parse error for {ccy}: {e}")
        return None


def is_stale(last_fetch_date: date) -> bool:
    """CFTC publishes every Friday — treat data older than 7 days as stale."""
    return (date.today() - last_fetch_date).days >= 7
