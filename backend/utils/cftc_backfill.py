import requests
import zipfile
import csv
import io
from datetime import date, timedelta

from utils.cftc_fetcher import CONTRACT_MAP_FOREX
from utils.cftc_fetcher import CONTRACT_MAP_FINANCIAL


def _parse_tff_text(text: str):
    """Same column layout/logic as the live weekly fetcher, applied to
    a full-year historical text blob."""
    reader = csv.reader(io.StringIO(text))
    rows = []

    for line in reader:
        if not line or len(line) < 24:
            continue

        contract_name = line[0].strip()
        if contract_name not in CONTRACT_MAP_FOREX or CONTRACT_MAP_FINANCIAL:
            continue

        try:
            report_date = date.fromisoformat(line[2].strip())

            open_interest    = int(line[7])
            large_spec_long  = int(line[14])
            large_spec_short = int(line[15])
            commercial_long  = int(line[8])
            commercial_short = int(line[9])
            small_spec_long  = int(line[22])
            small_spec_short = int(line[23])

            rows.append({
                "currency":          CONTRACT_MAP_FOREX[contract_name],
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


def _fetch_year_archive(year: int):
    """Downloads and extracts one year's CFTC TFF archive. Returns raw text,
    or None if that year's file isn't available (e.g. requesting a future year)."""
    url = f"https://www.cftc.gov/files/dea/history/fut_fin_txt_{year}.zip"

    res = requests.get(url, timeout=30)
    if res.status_code != 200:
        return None

    with zipfile.ZipFile(io.BytesIO(res.content)) as z:
        txt_filenames = [n for n in z.namelist() if n.lower().endswith(".txt")]
        if not txt_filenames:
            return None
        with z.open(txt_filenames[0]) as f:
            return f.read().decode("utf-8", errors="ignore")


def backfill_cot_history():
    """
    One-time (or occasional) backfill: pulls the current year's CFTC
    archive, and the prior year's too if needed to cover a full 52 weeks,
    then returns all parsed rows within the last 52 weeks.
    """
    today = date.today()
    cutoff = today - timedelta(weeks=52)

    all_rows = []

    for year in (today.year, today.year - 1):
        text = _fetch_year_archive(year)
        if text:
            all_rows.extend(_parse_tff_text(text))

    # keep only rows within our 52-week window
    recent_rows = [r for r in all_rows if r["report_date"] >= cutoff]

    return recent_rows
