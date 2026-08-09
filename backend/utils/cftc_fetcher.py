import httpx
from datetime import date, timedelta

# ── Endpoint URLs ─────────────────────────────────────────────────────
LEGACY_URL       = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"   # Forex
DISAGGREGATED_URL= "https://publicreporting.cftc.gov/resource/72hh-3qpy.json"   # Metals
TFF_URL          = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"   # Crypto

# ── Contract name → currency code maps ───────────────────────────────
CONTRACT_MAP_FOREX = {
    "EURO FX - CHICAGO MERCANTILE EXCHANGE":            "EUR",
    "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE":      "GBP",   # was "BRITISH POUND STERLING - ..."
    "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE":       "JPY",
    "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE":  "AUD",
    "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE":    "CAD",
    "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE":        "CHF",
    "NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE":          "NZD",   # was "NEW ZEALAND DOLLAR - ..."
    "USD INDEX - ICE FUTURES U.S.":                     "USD",   # add this — it's what Edge Finder needs for the Dollar Index
}

CONTRACT_MAP_METALS = {
    "GOLD - COMMODITY EXCHANGE INC.":            "XAU",
    "SILVER - COMMODITY EXCHANGE INC.":          "XAG",
    "PLATINUM - NEW YORK MERCANTILE EXCHANGE":   "XPT",
    "COPPER- #1 - COMMODITY EXCHANGE INC.":      "XCU",
}

CONTRACT_MAP_CRYPTO = {
    "BITCOIN - CHICAGO MERCANTILE EXCHANGE":             "BTC",
    "ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE":  "ETH",
}


def fetch_latest_cot() -> list:
    cutoff = (date.today() - timedelta(weeks=2)).isoformat()
    rows   = []
    seen   = set()

    with httpx.Client(timeout=30.0) as client:

        # ── 1. Forex — Legacy Futures Only ───────────────────────────
        try:
            res = client.get(
                LEGACY_URL,
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
                row = _parse_legacy(entry, ccy, seen)
                if row:
                    rows.append(row)
            print(f"COT forex: {sum(1 for r in rows if r['currency'] in CONTRACT_MAP_FOREX.values())} rows", flush=True)
        except Exception as e:
            print(f"COT forex fetch failed: {e}", flush=True)

        # ── 2. Metals — Disaggregated Futures Only ───────────────────
        # Field names differ: uses m_money_ prefix for managed money
        try:
            res2 = client.get(
                DISAGGREGATED_URL,
                params={
                    "$where": f"report_date_as_yyyy_mm_dd >= '{cutoff}'",
                    "$limit": "100",
                    "$order": "report_date_as_yyyy_mm_dd DESC"
                }
            )
            res2.raise_for_status()
            metal_count = 0
            for entry in res2.json():
                contract = entry.get("market_and_exchange_names", "").strip()
                ccy      = CONTRACT_MAP_METALS.get(contract)
                if not ccy:
                    continue
                row = _parse_disaggregated(entry, ccy, seen)
                if row:
                    rows.append(row)
                    metal_count += 1
            print(f"COT metals: {metal_count} rows", flush=True)
        except Exception as e:
            print(f"COT metals fetch failed: {e}", flush=True)

        # ── 3. Crypto — TFF Futures Only ─────────────────────────────
        # Field names differ: uses lev_money_ prefix for leveraged money
        try:
            res3 = client.get(
                TFF_URL,
                params={
                    "$where": f"report_date_as_yyyy_mm_dd >= '{cutoff}'",
                    "$limit": "50",
                    "$order": "report_date_as_yyyy_mm_dd DESC"
                }
            )
            res3.raise_for_status()
            crypto_count = 0
            for entry in res3.json():
                contract = entry.get("market_and_exchange_names", "").strip()
                ccy      = CONTRACT_MAP_CRYPTO.get(contract)
                if not ccy:
                    continue
                row = _parse_tff(entry, ccy, seen)
                if row:
                    rows.append(row)
                    crypto_count += 1
            print(f"COT crypto: {crypto_count} rows", flush=True)
        except Exception as e:
            print(f"COT crypto fetch failed: {e}", flush=True)

    print(f"COT total: {len(rows)} rows parsed", flush=True)
    return rows


def _parse_legacy(entry: dict, ccy: str, seen: set):
    """Legacy report — noncomm_positions_ fields for large speculators."""
    return _parse_entry(
        entry, ccy, seen,
        long_field  = "noncomm_positions_long_all",
        short_field = "noncomm_positions_short_all",
        comm_long   = "comm_positions_long_all",
        comm_short  = "comm_positions_short_all",
    )


def _parse_disaggregated(entry: dict, ccy: str, seen: set):
    """Disaggregated report — m_money_ fields for managed money."""
    return _parse_entry(
        entry, ccy, seen,
        long_field  = "m_money_positions_long_all",
        short_field = "m_money_positions_short_all",
        comm_long   = "prod_merc_positions_long_all",
        comm_short  = "prod_merc_positions_short_all",
    )


def _parse_tff(entry: dict, ccy: str, seen: set):
    """TFF report — lev_money_ fields for leveraged money (hedge funds)."""
    return _parse_entry(
        entry, ccy, seen,
        long_field  = "lev_money_positions_long_all",
        short_field = "lev_money_positions_short_all",
        comm_long   = "asset_mgr_positions_long_all",
        comm_short  = "asset_mgr_positions_short_all",
    )


def _parse_entry(entry, ccy, seen, long_field, short_field, comm_long, comm_short):
    """Generic parser — handles all three report formats."""
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
        large_spec_long  = int(entry.get(long_field,  0) or 0)
        large_spec_short = int(entry.get(short_field, 0) or 0)
        commercial_long  = int(entry.get(comm_long,   0) or 0)
        commercial_short = int(entry.get(comm_short,  0) or 0)
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
        print(f"COT parse error for {ccy}: {e}", flush=True)
        return None


def is_stale(last_fetch_date: date) -> bool:
    """CFTC publishes every Friday — treat data older than 7 days as stale."""
    return (date.today() - last_fetch_date).days >= 7
