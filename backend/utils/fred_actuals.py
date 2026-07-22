import httpx
import os
from datetime import date, datetime


FRED_SERIES = {
    "cpi_yoy": {
        "series_id": "CPIAUCSL",          # CPI index (not seasonally adj. YoY needs raw index)
        "label": "CPI y/y",
        "transform": "yoy_pct",
    },
    "unemployment_rate": {
        "series_id": "UNRATE",
        "label": "Unemployment Rate",
        "transform": "level",
    },
    "nonfarm_payrolls": {
        "series_id": "PAYEMS",             # level, in thousands — NFP is the month-over-month change
        "label": "Non-Farm Payrolls",
        "transform": "mom_diff_thousands",
    },
    "gdp_growth": {
        "series_id": "A191RL1Q225SBEA",    # real GDP % change, annualized, matches headline release
        "label": "GDP Growth",
        "transform": "level",
    },
}


async def _fetch_series(client: httpx.AsyncClient, series_id: str, limit: int = 14):
    fred_key = os.getenv("FRED_API_KEY")
    if not fred_key:
        return []

    try:
        res = await client.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id": series_id,
                "api_key": fred_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": limit,
            },
            timeout=15.0,
        )
        data = res.json()
        obs = [o for o in data.get("observations", []) if o.get("value") not in (".", None)]
        return obs
    except Exception as e:
        print(f"FRED actuals fetch failed for {series_id}: {e}", flush=True)
        return []


async def fetch_usd_actuals() -> dict:
    """
    Returns a dict keyed by our internal metric name, each with the most
    recently *released* actual value and the date it was reported —
    used to backfill 'actual' on calendar events the free calendar feed
    leaves empty.
    """
    results = {}

    async with httpx.AsyncClient() as client:
        for key, meta in FRED_SERIES.items():
            obs = await _fetch_series(client, meta["series_id"])
            if not obs:
                results[key] = None
                continue

            try:
                if meta["transform"] == "level":
                    latest = obs[0]
                    value = round(float(latest["value"]), 2)
                    results[key] = {
                        "label": meta["label"],
                        "value": value,
                        "unit": "%",
                        "date": latest["date"],
                    }

                elif meta["transform"] == "mom_diff_thousands":
                    latest, previous = obs[0], obs[1]
                    diff = round(float(latest["value"]) - float(previous["value"]), 0)
                    results[key] = {
                        "label": meta["label"],
                        "value": diff,
                        "unit": "K",
                        "date": latest["date"],
                    }

                elif meta["transform"] == "yoy_pct":
                    # find the observation ~12 months before the latest
                    latest = obs[0]
                    latest_date = datetime.fromisoformat(latest["date"])
                    year_ago_target = latest_date.replace(year=latest_date.year - 1)

                    prior = min(
                        obs[1:],
                        key=lambda o: abs((datetime.fromisoformat(o["date"]) - year_ago_target).days),
                        default=None,
                    )
                    if prior is None:
                        results[key] = None
                        continue

                    pct = round(
                        ((float(latest["value"]) - float(prior["value"])) / float(prior["value"])) * 100, 1
                    )
                    results[key] = {
                        "label": meta["label"],
                        "value": pct,
                        "unit": "%",
                        "date": latest["date"],
                    }

            except (ValueError, KeyError, IndexError) as e:
                print(f"FRED transform failed for {key}: {e}", flush=True)
                results[key] = None

    return results


# ── Matching calendar event titles to our FRED metrics ────────────────
EVENT_KEYWORD_MAP = [
    (["CPI", "Consumer Price Index"], "cpi_yoy"),
    (["Unemployment Rate"], "unemployment_rate"),
    (["Non-Farm", "Non-farm", "NFP", "Employment Change"], "nonfarm_payrolls"),
    (["GDP"], "gdp_growth"),
]


def match_event_to_metric(title: str):
    title_lower = title.lower()
    for keywords, metric_key in EVENT_KEYWORD_MAP:
        if any(k.lower() in title_lower for k in keywords):
            return metric_key
    return None
