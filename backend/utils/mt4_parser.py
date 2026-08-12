from datetime import datetime
import time
from bs4 import BeautifulSoup


def parse_mt4_report(html_content: str) -> list:
    """
    Parses an MT4 'Save as Report' export (Account History → right-click →
    Save as Report). Skips balance/credit rows and header rows, keeps only
    closed BUY/SELL trades.
    """
    soup  = BeautifulSoup(html_content, "html.parser")
    rows  = soup.find_all("tr")
    trades = []

    for row in rows:
        cells = [c.get_text(strip=True) for c in row.find_all("td")]
        if len(cells) < 13:
            continue

        ticket = cells[0]
        if not ticket.isdigit():
            continue  # header/summary row

        trade_type = cells[2].lower()
        if trade_type not in ("buy", "sell"):
            continue  # balance, credit, or other non-trade row

        try:
            trades.append({
                "ticket":      ticket,
                "symbol":      cells[4].upper(),
                "order_type":  "BUY" if trade_type == "buy" else "SELL",
                "lot_size":    float(cells[3]),
                "open_price":  float(cells[5]),
                "close_price": float(cells[9]),
                "profit":      float(cells[-1].replace(",", "")),
                "time":        _parse_mt4_datetime(cells[8])
            })
        except (ValueError, IndexError):
            continue

    return trades


def _parse_mt4_datetime(date_str: str) -> int:
    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M"):
        try:
            return int(datetime.strptime(date_str, fmt).timestamp())
        except ValueError:
            continue
    return int(time.time())
