import httpx
import csv
import io
from datetime import date, timedelta

CFTC_URL = "https://www.cftc.gov/dea/newcot/FinFutWk.txt"

# CFTC contract names → our currency codes
CONTRACT_MAP = {
    "EURO FX - CHICAGO MERCANTILE EXCHANGE":         "EUR",
    "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE": "GBP",
    "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE":    "JPY",
    "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE": "AUD",
    "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE": "CAD",
    "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE":     "CHF",
    "NEW ZEALAND DOLLAR - CHICAGO MERCANTILE EXCHANGE": "NZD",

}


def fetch_latest_cot():
    """
    Downloads the CFTC weekly Financial Futures Commitment of Traders
    report and returns parsed rows for the currencies we track.
    Raises on network/parse failure so caller can fall back to cache.
    """
    res = requests.get(CFTC_URL, timeout=20)
    res.raise_for_status()

    reader = csv.reader(io.StringIO(res.text))
    rows = []

    for line in reader:
        if not line or len(line) < 20:
            continue

        contract_name = line[0].strip()
        if contract_name not in CONTRACT_MAP:
            continue

        try:
            report_date = date(
                int(line[2][:4]), int(line[2][4:6]), int(line[2][6:8])
            )

            large_spec_long  = int(line[8])
            large_spec_short = int(line[9])
            commercial_long  = int(line[10])
            commercial_short = int(line[11])
            open_interest    = int(line[7])

            total_reportable_long  = large_spec_long + commercial_long
            total_reportable_short = large_spec_short + commercial_short
            small_spec_long  = max(0, open_interest - total_reportable_long)
            small_spec_short = max(0, open_interest - total_reportable_short)

            rows.append({
                "currency":          CONTRACT_MAP[contract_name],
                "report_date":       report_date,
                "large_spec_long":   large_spec_long,
                "large_spec_short":  large_spec_short,
                "commercial_long":   commercial_long,
                "commercial_short":  commercial_short,
                "small_spec_long":   small_spec_long,
                "small_spec_short":  small_spec_short,
                "net_position":      large_spec_long - large_spec_short,
                "open_interest":     open_interest,
            })
        except (ValueError, IndexError):
            continue

    return rows


def is_stale(last_fetch_date: date) -> bool:
    """CFTC publishes every Friday — treat data older than 7 days as stale."""
    return (date.today() - last_fetch_date).days >= 7
