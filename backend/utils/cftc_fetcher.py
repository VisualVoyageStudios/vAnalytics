import requests
import csv
import io
from datetime import date, timedelta

CFTC_URL = "https://www.cftc.gov/dea/newcot/FinFutWk.txt"

# CFTC contract names (verified against a real pulled file) → our currency codes
CONTRACT_MAP = {
    "VIX FUTURES - CBOE FUTURES EXCHANGE":              "VIX INDEX",
    "USD INDEX - ICE FUTURES U.S.":                     "US DOLLAR INDEX",
    "DJIA x $5 - CHICAGO BOARD OF TRADE":               "DOW JONES",
    "S&P 500 Consolidated - CHICAGO MERCANTILE EXCHANGE": "S&P 500",
    "NAS100 Consolidated - CHICAGO MERCANTILE EXCHANGE":  "NAS 100",
    "EURO FX - CHICAGO MERCANTILE EXCHANGE":            "EUR",
    "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE":      "GBP",
    "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE":       "JPY",
    "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE":  "AUD",
    "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE":    "CAD",
    "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE":        "CHF",
    "NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE":          "NZD",
    "SO AFRICAN RAND - CHICAGO MERCANTILE EXCHANGE":    "ZAR",
    "BITCOIN - CHICAGO MERCANTILE EXCHANGE":            "BTC",
    "XRP - CHICAGO MERCANTILE EXCGANGE":                "XRP",
    "MICRO ETHER - CHICAGO MERCANTILE EXCHANGE":        "ETH",
    
}


def fetch_latest_cot():
    """
    Downloads the CFTC weekly Traders in Financial Futures (TFF) report
    and returns parsed rows for the currencies we track.

    Column layout (0-indexed), verified against a live pulled file:
      0  Market_and_Exchange_Names
      1  As_of_Date_YYMMDD
      2  As_of_Date_YYYY-MM-DD   (ISO format, NOT packed YYYYMMDD)
      7  Open_Interest_All
      8  Dealer_Long        9  Dealer_Short       10  Dealer_Spread
      11 AssetMgr_Long      12 AssetMgr_Short     13  AssetMgr_Spread
      14 LevMoney_Long      15 LevMoney_Short     16  LevMoney_Spread
      17 OtherRept_Long     18 OtherRept_Short    19  OtherRept_Spread
      20 Tot_Rept_Long      21 Tot_Rept_Short
      22 NonRept_Long       23 NonRept_Short

    We use Leveraged Funds as "large speculators" (the standard proxy for
    hedge fund/CTA positioning), Dealer as "commercial", and Non-Reportable
    as "small speculators".
    """
    res = requests.get(CFTC_URL, timeout=20)
    res.raise_for_status()

    reader = csv.reader(io.StringIO(res.text))
    rows = []

    for line in reader:
        if not line or len(line) < 24:
            continue

        contract_name = line[0].strip()
        if contract_name not in CONTRACT_MAP:
            continue

        try:
            report_date = date.fromisoformat(line[2].strip())

            open_interest     = int(line[7])

            large_spec_long   = int(line[14])   # Leveraged Funds long
            large_spec_short  = int(line[15])   # Leveraged Funds short
            commercial_long   = int(line[8])    # Dealer/Intermediary long
            commercial_short  = int(line[9])    # Dealer/Intermediary short
            small_spec_long   = int(line[22])   # Non-Reportable long
            small_spec_short  = int(line[23])   # Non-Reportable short

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
