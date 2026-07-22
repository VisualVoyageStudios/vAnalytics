import os
import uuid
import httpx
import json
import hashlib
import time
import calendar
import traceback
import asyncio

from models.goal import Goal
from schemas.goal import GoalCreate
from models.currency_snapshot import CurrencySnapshot
from models.challenge import UserChallenge
from models.journal_template import JournalTemplate
from models.cache_store import CacheStore

from uuid import uuid4
from datetime import datetime, timedelta
from typing import List, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import engine, get_db, SessionLocal
from models.user import Base, User
from models.account import Account
from models.journal import Journal
from models.trade import Trade

from schemas.user import UserRegister, UserLogin
from schemas.trade import TradeCreate
from schemas.account import AccountCreate
from schemas.journal import JournalCreate

from dependencies import get_current_user
from security import hash_password, verify_password
from auth_token import create_access_token

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request

from utils.cot_scheduler import start_cot_scheduler, refresh_cot_data

# MT5 is Windows-only
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False

#persistent helper
from models.cache_store import CacheStore
def load_persistent_cache(key: str):
    db = SessionLocal()
    try:
        row = db.query(CacheStore).filter(CacheStore.key == key).first()
        if row:
            return json.loads(row.value), row.updated_at.timestamp()
        return None, 0
    except Exception as e:
        print(f"load_persistent_cache failed for {key}: {e}")
        return None, 0
    finally:
        db.close()

def save_persistent_cache(key: str, data):
    db = SessionLocal()
    try:
        row = db.query(CacheStore).filter(CacheStore.key == key).first()
        payload = json.dumps(data)
        if row:
            row.value = payload
            row.updated_at = datetime.utcnow()
        else:
            db.add(CacheStore(key=key, value=payload, updated_at=datetime.utcnow()))
        db.commit()
    except Exception as e:
        print(f"save_persistent_cache failed for {key}: {e}")
        db.rollback()
    finally:
        db.close()


Base.metadata.create_all(bind=engine)

# Auto-migration
from sqlalchemy import text
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT FALSE"))
        conn.commit()
    except Exception:
        conn.rollback()
        
    try:
        conn.execute(text("ALTER TABLE trades ADD COLUMN stop_loss FLOAT"))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"stop_loss migration skipped/failed: {e}")
        
    try:
        conn.execute(text("ALTER TABLE trades ADD COLUMN take_profit FLOAT"))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"take_profit migration skipped/failed: {e}")

    try:
        conn.execute(text("CREATE TABLE IF NOT EXISTS user_challenges (id VARCHAR PRIMARY KEY, user_id VARCHAR NOT NULL, week VARCHAR NOT NULL, rule_type VARCHAR NOT NULL, rule_value FLOAT NOT NULL, description VARCHAR NOT NULL, achieved BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())"))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"user_challenges migration skipped/failed: {e}")

    try:
        conn.execute(text("ALTER TABLE journals ADD COLUMN created_at TIMESTAMP DEFAULT NOW()"))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"journals created_at migration skipped/failed: {e}")

    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS journal_templates (
                id VARCHAR PRIMARY KEY,
                user_id VARCHAR NOT NULL,
                field VARCHAR NOT NULL,
                text VARCHAR NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"journal_templates migration skipped/failed: {e}")


    try:
        conn.execute(text("UPDATE trades SET order_type = 'BUY' WHERE order_type = '0'"))
        conn.execute(text("UPDATE trades SET order_type = 'SELL' WHERE order_type = '1'"))
        conn.commit()
        print("order_type migration complete")
    except Exception as e:
        conn.rollback()
        print(f"order_type migration skipped/failed: {e}")

app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

CORS_ORIGINS = [
    "https://voyageranalytics.netlify.app",
    "https://visualvoyagestudios.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# ── COT PULL DATA ON STARTUP
cot_scheduler = start_cot_scheduler()

#COT get data on start up
@app.on_event("startup")
def seed_cot_on_boot():
    """
    If the table is empty (fresh DB / new environment), do one immediate
    fetch on boot so the page isn't empty until the next Friday.
    """
    db = SessionLocal()
    try:
        from models.cot import COTPosition
        has_data = db.query(COTPosition).first()
        if not has_data:
            print("COT table empty — running initial fetch on boot")
            refresh_cot_data()
    finally:
        db.close()
# calandar data get start up
@app.on_event("startup")
def warm_economic_calendar_cache():
    data, ts = load_persistent_cache("economic_calendar")
    if data:
        economic_calendar_cache["data"]      = data
        economic_calendar_cache["timestamp"] = ts
        print(f"Warmed economic calendar cache from disk ({len(data)} events)")

# ── AI Cache 

ai_cache = {}
AI_CACHE_TTL = 3600

def get_cache_key(prompt: str) -> str:
    return hashlib.md5(prompt.encode()).hexdigest()

def get_cached_response(prompt: str):
    key  = get_cache_key(prompt)
    item = ai_cache.get(key)
    if item and (time.time() - item["timestamp"]) < AI_CACHE_TTL:
        print(f"Cache hit: {key[:8]}")
        return item["text"]
    return None

def set_cached_response(prompt: str, text: str):
    key = get_cache_key(prompt)
    ai_cache[key] = {"text": text, "timestamp": time.time()}
    print(f"Cached: {key[:8]}")

# ── TradeImport schema 

class TradeImport(BaseModel):
    ticket: str
    symbol: str
    order_type: str
    lot_size: float
    open_price: float
    close_price: float
    profit: float
    time: int
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None

# ── Currency strength snapshot history (Postgres-backed) ─────────────
# NOTE: these constants must stay at module scope, defined before any
# function that references them (including the background task below),
# or the pruning loop will crash on startup with a NameError.

SNAPSHOT_MAX_AGE_HOURS           = 72
SNAPSHOT_TARGET_LOOKBACK         = timedelta(hours=24)
SNAPSHOT_MIN_COMPARISON_AGE      = timedelta(hours=20)
SNAPSHOT_PRUNE_INTERVAL_SECONDS  = 6 * 3600

currency_strength_last_good = {"data": None}


def _closest_snapshot(db: Session, target_lookback: timedelta):
    target_time    = datetime.utcnow() - target_lookback
    min_age_cutoff = datetime.utcnow() - SNAPSHOT_MIN_COMPARISON_AGE

    older = (
        db.query(CurrencySnapshot)
        .filter(CurrencySnapshot.created_at <= target_time)
        .order_by(CurrencySnapshot.created_at.desc())
        .first()
    )
    newer = (
        db.query(CurrencySnapshot)
        .filter(CurrencySnapshot.created_at > target_time)
        .filter(CurrencySnapshot.created_at <= min_age_cutoff)
        .order_by(CurrencySnapshot.created_at.asc())
        .first()
    )

    candidates = [s for s in [older, newer] if s is not None]
    if not candidates:
        return None

    return min(candidates, key=lambda s: abs((s.created_at - target_time).total_seconds()))


async def _prune_snapshots_loop():
    while True:
        try:
            db = SessionLocal()
            cutoff = datetime.utcnow() - timedelta(hours=SNAPSHOT_MAX_AGE_HOURS)
            deleted = db.query(CurrencySnapshot).filter(CurrencySnapshot.created_at < cutoff).delete()
            db.commit()
            db.close()
            if deleted:
                print(f"Pruned {deleted} old currency snapshots")
        except Exception as e:
            print(f"Snapshot prune error: {str(e)}")

        await asyncio.sleep(SNAPSHOT_PRUNE_INTERVAL_SECONDS)


@app.on_event("startup")
async def start_background_tasks():
    asyncio.create_task(_prune_snapshots_loop())

# ─────────────────────────────────────────
#  ROOT
# ─────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Voyager Analytics API Running"}

# ─────────────────────────────────────────
#  AUTH
# ─────────────────────────────────────────

@app.post("/register")
@limiter.limit("5/minute")
def register_user(request: Request, user: UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already exists")
    new_user = User(
        id=str(uuid4()),
        email=user.email,
        password_hash=hash_password(user.password)
    )
    db.add(new_user)
    db.commit()
    return {"message": "User registered successfully"}


@app.post("/login")
@limiter.limit("10/minute")
def login_user(request: Request, user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"user_id": db_user.id, "email": db_user.email})
    return {"token": token, "email": db_user.email}


@app.get("/auth/me")
def get_me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    return {"email": user.email, "is_premium": user.is_premium}


@app.post("/auth/change-password")
def change_password(payload: dict, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(payload["new_password"])
    db.commit()
    return {"message": "Password updated"}


@app.delete("/auth/delete-account")
def delete_account_user(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user["user_id"]
    db.query(Journal).filter(Journal.user_id == user_id).delete(synchronize_session=False)
    account_ids = [a.id for a in db.query(Account).filter(Account.user_id == user_id).all()]
    db.query(Trade).filter(Trade.account_id.in_(account_ids)).delete(synchronize_session=False)
    db.query(Account).filter(Account.user_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()
    return {"message": "Account deleted"}

# ─────────────────────────────────────────
#  ACCOUNTS
# ─────────────────────────────────────────

@app.post("/accounts")
def create_account(account: AccountCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    new_account = Account(
        id=str(uuid4()),
        user_id=current_user["user_id"],
        broker=account.broker,
        account_number=account.account_number,
        server=account.server,
        investor_password=account.investor_password
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    return {"message": "Account created"}


@app.get("/accounts")
def get_accounts(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Account).filter(Account.user_id == current_user["user_id"]).all()


@app.delete("/accounts/{account_id}")
def delete_account(account_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    account = db.query(Account).filter(
        Account.id == account_id,
        Account.user_id == current_user["user_id"]
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(account)
    db.commit()
    return {"message": "Account deleted"}

# ─────────────────────────────────────────
#  TRADES
# ─────────────────────────────────────────

@app.post("/trades")
def create_trade(trade: TradeCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    trade_account = db.query(Account).filter(Account.id == trade.account_id).first()
    if not trade_account:
        raise HTTPException(status_code=404, detail="Account not found")
    new_trade = Trade(
        id=str(uuid4()),
        account_id=trade.account_id,
        symbol=trade.symbol,
        order_type=trade.order_type,
        lot_size=trade.lot_size,
        open_price=trade.open_price,
        close_price=trade.close_price,
        profit=trade.profit,
        stop_loss=trade.stop_loss,
        take_profit=trade.take_profit
    )
    db.add(new_trade)
    db.commit()
    return {"message": "Trade created"}


@app.get("/trades")
def get_trades(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[str] = Query(None)
):
    all_account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    if account_id and account_id in all_account_ids:
        filter_ids = [account_id]
    else:
        filter_ids = all_account_ids
    return db.query(Trade).filter(Trade.account_id.in_(filter_ids)).all()



@app.delete("/trades/{trade_id}")
def delete_trade(trade_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    db.delete(trade)
    db.commit()
    return {"message": "Trade deleted"}


@app.post("/trades/import")
def import_trades(trades: List[TradeImport], current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user_accounts = db.query(Account).filter(Account.user_id == current_user["user_id"]).all()
    if not user_accounts:
        raise HTTPException(status_code=404, detail="No account linked")
    account_id = user_accounts[0].id
    imported = 0
    for t in trades:
        existing = db.query(Trade).filter(Trade.ticket == t.ticket).first()
        if existing:
            continue
        trade = Trade(
            id=str(uuid.uuid4()),
            account_id=account_id,
            symbol=t.symbol,
            order_type=t.order_type,
            lot_size=t.lot_size,
            open_price=t.open_price,
            close_price=t.close_price,
            profit=t.profit,
            ticket=t.ticket,
            stop_loss=t.stop_loss,
            take_profit=t.take_profit,
            created_at=datetime.fromtimestamp(t.time)
        )
        db.add(trade)
        imported += 1
    db.commit()
    return {"status": "success", "imported": imported}

# ─────────────────────────────────────────
#  TRADE IDEAS
# ─────────────────────────────────────────

trade_ideas_cache = {"data": None, "timestamp": 0}
TRADE_IDEAS_CACHE_TTL = 3600  # 1 hour

@app.get("/trade-ideas")
async def get_trade_ideas(current_user=Depends(get_current_user)):

    now = time.time()

    if trade_ideas_cache["data"] and (now - trade_ideas_cache["timestamp"]) < TRADE_IDEAS_CACHE_TTL:
        return trade_ideas_cache["data"]

    # fetch live policy rates
    policy_rates = await fetch_policy_rates()

    country_map = {
        "US": "USD", "XC": "EUR", "GB": "GBP",
        "JP": "JPY", "AU": "AUD", "CA": "CAD",
        "NZ": "NZD", "CH": "CHF", "ZA": "ZAR"
    }

    country_codes = ";".join(country_map.keys())
    indicators    = {
        "gdp_growth":   "NY.GDP.MKTP.KD.ZG",
        "inflation":    "FP.CPI.TOTL.ZG",
        "unemployment": "SL.UEM.TOTL.ZS"
    }

    scores = {code: 0 for code in country_map.values()}

    async with httpx.AsyncClient() as client:
        for metric, indicator in indicators.items():
            try:
                res  = await client.get(
                    f"https://api.worldbank.org/v2/country/{country_codes}/indicator/{indicator}",
                    params={"format": "json", "mrv": 1, "per_page": 20},
                    timeout=30.0
                )
                data = res.json()
                if isinstance(data, list) and len(data) > 1 and data[1]:
                    for entry in data[1]:
                        ccy   = country_map.get(entry["country"]["id"])
                        value = entry["value"]
                        if ccy and value is not None:
                            if metric == "gdp_growth":
                                scores[ccy] += 2 if value >= 3 else 1 if value >= 1.5 else 0 if value >= 0 else -1
                            elif metric == "inflation":
                                scores[ccy] += 1 if 1.5 <= value <= 3 else -1 if value > 5 else 0
                            elif metric == "unemployment":
                                scores[ccy] += 2 if value <= 4 else 1 if value <= 5.5 else 0 if value <= 7 else -1
            except Exception as e:
                print(f"Trade ideas WB fetch failed: {str(e)}")

    # add live policy rate scoring
    for ccy in scores:
        pol  = policy_rates.get(ccy, {})
        rate = pol.get("rate", 0) or 0
        if rate >= 4.0:   scores[ccy] += 2
        elif rate >= 2.0: scores[ccy] += 1
        elif rate >= 0.5: scores[ccy] += 0
        else:              scores[ccy] -= 1

    PAIRS = [
        ("EUR","USD"),("GBP","USD"),("USD","JPY"),
        ("USD","CHF"),("AUD","USD"),("USD","CAD"),
        ("NZD","USD"),("GBP","JPY"),("EUR","GBP"),
        ("EUR","JPY"),("AUD","JPY"),("GBP","CHF"),
        ("AUD","NZD"),("EUR","AUD"),("CAD","JPY"),
        ("USD","ZAR"),("EUR","ZAR")
    ]

    ideas = []
    for base, quote in PAIRS:
        base_score  = scores.get(base, 0)
        quote_score = scores.get(quote, 0)
        diff        = base_score - quote_score

        if abs(diff) < 1:
            continue

        direction  = "LONG" if diff > 0 else "SHORT"
        pair       = f"{base}{quote}"
        conviction = "High" if abs(diff) >= 4 else "Medium" if abs(diff) >= 2 else "Low"
        bias_base  = base if diff > 0 else quote
        bias_quote = quote if diff > 0 else base

        ideas.append({
            "pair":        pair,
            "direction":   direction,
            "conviction":  conviction,
            "score":       diff,
            "score_abs":   abs(diff),
            "base":        base,
            "quote":       quote,
            "base_score":  base_score,
            "quote_score": quote_score,
            "rationale":   f"{bias_base} fundamentally stronger than {bias_quote} — score differential of {abs(diff)}."
        })

    ideas.sort(key=lambda x: x["score_abs"], reverse=True)

    result = {
        "ideas":      ideas[:12],
        "scores":     scores,
        "updated_at": datetime.utcnow().isoformat()
    }

    trade_ideas_cache["data"]      = result
    trade_ideas_cache["timestamp"] = now

    return result

# ─────────────────────────────────────────
#  DATA
# ─────────────────────────────────────────

@app.delete("/data/clear")
def clear_data(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    db.query(Trade).filter(Trade.account_id.in_(account_ids)).delete(synchronize_session=False)
    db.query(Journal).filter(Journal.user_id == current_user["user_id"]).delete(synchronize_session=False)
    db.commit()
    return {"message": "All data cleared"}

# ─────────────────────────────────────────
#  JOURNALS
# ─────────────────────────────────────────

@app.post("/journals")
def create_journal(journal: JournalCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    new_journal = Journal(
        id=str(uuid.uuid4()),
        user_id=current_user["user_id"],
        trade_id=journal.trade_id,
        emotion=journal.emotion,
        lesson=journal.lesson,
        mistake=journal.mistake,
        rating=journal.rating
    )
    db.add(new_journal)
    db.commit()
    return {"message": "Journal saved"}


@app.get("/journals")
def get_journals(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Journal).filter(Journal.user_id == current_user["user_id"]).all()


# ─────────────────────────────────────────
#  JOURNAL TEMPLATES
# ─────────────────────────────────────────

DEFAULT_TEMPLATES = {
    "lesson": [
        "Wait for confirmation before entering",
        "Stick to the trading plan",
        "Let winners run longer",
        "Cut losses faster",
        "Trade with the trend",
        "Avoid trading during high-impact news",
        "Risk management saved me here",
        "Patience paid off on this one",
    ],
    "mistake": [
        "Entered too early without confirmation",
        "Moved stop loss under pressure",
        "Overtraded after a loss",
        "Ignored the higher timeframe",
        "FOMO entry — chased the move",
        "Took revenge trade after loss",
        "Sized too large for the setup",
        "Closed too early out of fear",
    ]
}


@app.get("/journals/templates")
def get_templates(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user_templates = db.query(JournalTemplate).filter(
        JournalTemplate.user_id == current_user["user_id"]
    ).all()

    custom = {"lesson": [], "mistake": []}
    for t in user_templates:
        if t.field in custom:
            custom[t.field].append({"id": t.id, "text": t.text})

    return {
        "defaults": DEFAULT_TEMPLATES,
        "custom":   custom
    }


@app.post("/journals/templates")
def add_template(payload: dict, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    field = payload.get("field")
    text  = payload.get("text", "").strip()

    if field not in ("lesson", "mistake"):
        raise HTTPException(status_code=400, detail="field must be 'lesson' or 'mistake'")
    if not text:
        raise HTTPException(status_code=400, detail="text cannot be empty")
    if len(text) > 200:
        raise HTTPException(status_code=400, detail="text too long (max 200 chars)")

    template = JournalTemplate(
        id=str(uuid4()),
        user_id=current_user["user_id"],
        field=field,
        text=text
    )
    db.add(template)
    db.commit()
    return {"message": "Template saved", "id": template.id}


@app.delete("/journals/templates/{template_id}")
def delete_template(template_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    template = db.query(JournalTemplate).filter(
        JournalTemplate.id == template_id,
        JournalTemplate.user_id == current_user["user_id"]
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
    return {"message": "Template deleted"}


# ─────────────────────────────────────────
#  MISTAKE PATTERN DETECTION
# ─────────────────────────────────────────

mistake_pattern_cache = {}  # keyed by user_id
MISTAKE_CACHE_TTL = 3600    # 1 hour


@app.get("/journals/mistake-patterns")
async def get_mistake_patterns(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user["user_id"]

    # serve from cache if fresh
    cached = mistake_pattern_cache.get(user_id)
    if cached and (time.time() - cached["timestamp"]) < MISTAKE_CACHE_TTL:
        return cached["data"]

    journals = db.query(Journal).filter(
        Journal.user_id == user_id
    ).all()

    mistakes = [j.mistake for j in journals if j.mistake and j.mistake.strip()]

    if len(mistakes) < 3:
        return {
            "patterns": [],
            "insufficient_data": True,
            "entries_needed": 3 - len(mistakes)
        }

    mistakes_text = "\n".join(f"- {m}" for m in mistakes)

    prompt = (
        "You are an expert trading psychology coach. "
        "Analyse these trading mistake journal entries and identify recurring behavioural patterns. "
        "Return ONLY a valid JSON array with no markdown, no preamble:\n"
        '[{"pattern": "Short pattern name", "description": "2 sentences explaining the pattern and its impact", '
        '"frequency": "how often it appears (e.g. frequent/occasional/rare)", '
        '"advice": "One actionable sentence to address this pattern", '
        '"severity": "high/medium/low"}]\n\n'
        f"Journal entries:\n{mistakes_text}\n\n"
        "Identify 3-5 patterns maximum. Return ONLY the JSON array."
    )

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.getenv('GROQ_API_KEY')}",
                    "Content-Type":  "application/json"
                },
                json={
                    "model":    "llama-3.1-8b-instant",
                    "max_tokens": 1000,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=30.0
            )

        data = res.json()

        if "choices" not in data:
            raise HTTPException(status_code=500, detail=f"Groq error: {data}")

        text     = data["choices"][0]["message"]["content"]
        clean    = text.replace("```json", "").replace("```", "").strip()
        patterns = json.loads(clean)

        result = {
            "patterns":          patterns,
            "insufficient_data": False,
            "entries_analysed":  len(mistakes)
        }

        mistake_pattern_cache[user_id] = {
            "data":      result,
            "timestamp": time.time()
        }

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Could not parse AI response: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Mistake pattern error: {type(e).__name__}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))




# ─────────────────────────────────────────
#  ANALYTICS
# ─────────────────────────────────────────

@app.get("/analytics")
def get_analytics(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[str] = Query(None)
):
    all_account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    filter_ids = [account_id] if account_id and account_id in all_account_ids else all_account_ids
    trades = db.query(Trade).filter(Trade.account_id.in_(filter_ids)).all()

    if not trades:
        return {
            "total_profit": 0, "win_rate": 0, "best_trade": 0,
            "worst_trade": 0, "trade_count": 0, "profit_factor": 0,
            "average_win": 0, "average_loss": 0, "expectancy": 0,
            "largest_win": 0, "largest_loss": 0, "average_trade": 0, "max_drawdown": 0
        }

    profits       = [t.profit for t in trades]
    wins          = [p for p in profits if p > 0]
    losses        = [p for p in profits if p < 0]
    gross_profit  = sum(wins)
    gross_loss    = abs(sum(losses))
    win_rate      = round((len(wins) / len(profits)) * 100, 2) if profits else 0
    loss_rate     = 100 - win_rate
    average_win   = round(sum(wins) / len(wins), 2) if wins else 0
    average_loss  = round(sum(losses) / len(losses), 2) if losses else 0
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0
    expectancy    = round(((win_rate / 100) * average_win) + ((loss_rate / 100) * average_loss), 2)

    equity = peak = max_drawdown = 0
    for p in profits:
        equity += p
        if equity > peak:
            peak = equity
        drawdown = peak - equity
        if drawdown > max_drawdown:
            max_drawdown = drawdown

    return {
        "trade_count":   len(profits),
        "total_profit":  round(sum(profits), 2),
        "win_rate":      win_rate,
        "best_trade":    max(profits),
        "worst_trade":   min(profits),
        "profit_factor": profit_factor,
        "average_win":   average_win,
        "average_loss":  average_loss,
        "expectancy":    expectancy,
        "largest_win":   max(profits),
        "largest_loss":  min(profits),
        "average_trade": round(sum(profits) / len(profits), 2),
        "max_drawdown":  round(max_drawdown, 2)
    }



@app.get("/analytics/heatmap")
def get_heatmap(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[str] = Query(None)
):
    all_account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    filter_ids = [account_id] if account_id and account_id in all_account_ids else all_account_ids
    trades = db.query(Trade).filter(Trade.account_id.in_(filter_ids)).all()
    daily_results = {}

    for trade in trades:
        day = trade.created_at.date().isoformat()
        if day not in daily_results:
            daily_results[day] = {"profit": 0, "trades": 0}
        daily_results[day]["profit"] += trade.profit
        daily_results[day]["trades"] += 1

    return sorted(
        [{"date": day, "profit": round(v["profit"], 2), "trades": v["trades"]}
         for day, v in daily_results.items()],
        key=lambda x: x["date"]
    )


@app.get("/analytics/day/{date}")
def get_day_details(date: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    trades      = db.query(Trade).filter(Trade.account_id.in_(account_ids)).all()
    return [
        {"symbol": t.symbol, "profit": t.profit, "ticket": t.ticket}
        for t in trades if t.created_at.date().isoformat() == date
    ]


@app.get("/analytics/monthly")
def get_monthly_performance(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[str] = Query(None)
):
    all_account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    filter_ids = [account_id] if account_id and account_id in all_account_ids else all_account_ids
    trades = db.query(Trade).filter(Trade.account_id.in_(filter_ids)).all()
    monthly_data = {}

    for trade in trades:
        month = trade.created_at.strftime("%Y-%m")
        if month not in monthly_data:
            monthly_data[month] = {"profit": 0, "trades": 0, "wins": 0}
        monthly_data[month]["profit"] += trade.profit
        monthly_data[month]["trades"] += 1
        if trade.profit > 0:
            monthly_data[month]["wins"] += 1

    return [
        {
            "month":    month,
            "profit":   round(data["profit"], 2),
            "trades":   data["trades"],
            "win_rate": round((data["wins"] / data["trades"]) * 100, 1)
        }
        for month, data in monthly_data.items()
    ]


@app.get("/analytics/sessions")
async def get_session_analysis(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[str] = Query(None)
):
    all_account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    filter_ids = [account_id] if account_id and account_id in all_account_ids else all_account_ids
    trades = db.query(Trade).filter(Trade.account_id.in_(filter_ids)).all()

    sessions = {
        "Asian":    {"start": 0,  "end": 9,  "trades": 0, "wins": 0, "profit": 0.0},
        "London":   {"start": 7,  "end": 16, "trades": 0, "wins": 0, "profit": 0.0},
        "New York": {"start": 12, "end": 21, "trades": 0, "wins": 0, "profit": 0.0},
        "Pacific":  {"start": 21, "end": 24, "trades": 0, "wins": 0, "profit": 0.0},
    }

    for trade in trades:
        hour = trade.created_at.hour
        for name, s in sessions.items():
            if s["start"] <= hour < s["end"]:
                s["trades"] += 1
                s["profit"] += trade.profit
                if trade.profit > 0:
                    s["wins"] += 1

    return [
        {
            "session":  name,
            "trades":   s["trades"],
            "wins":     s["wins"],
            "losses":   s["trades"] - s["wins"],
            "profit":   round(s["profit"], 2),
            "win_rate": round((s["wins"] / s["trades"]) * 100, 1) if s["trades"] > 0 else 0,
            "hours":    f"{s['start']:02d}:00 - {s['end']:02d}:00 UTC"
        }
        for name, s in sessions.items()
    ]


@app.get("/analytics/streaks")
async def get_streaks(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[str] = Query(None)
):
    all_account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    filter_ids = [account_id] if account_id and account_id in all_account_ids else all_account_ids
    trades = db.query(Trade).filter(Trade.account_id.in_(filter_ids)).order_by(Trade.created_at.asc()).all()

    if not trades:
        return {
            "current_streak": 0, "current_streak_type": "none",
            "best_win_streak": 0, "worst_loss_streak": 0,
            "longest_win_streak": 0, "longest_loss_streak": 0,
            "streak_history": []
        }

    streak_history = []
    current_streak = 1
    current_type   = "win" if trades[0].profit > 0 else "loss"

    for i in range(1, len(trades)):
        trade_type = "win" if trades[i].profit > 0 else "loss"
        if trade_type == current_type:
            current_streak += 1
        else:
            streak_history.append({
                "type": current_type, "length": current_streak,
                "date": trades[i - 1].created_at.date().isoformat()
            })
            current_streak = 1
            current_type   = trade_type

    streak_history.append({
        "type": current_type, "length": current_streak,
        "date": trades[-1].created_at.date().isoformat()
    })

    win_streaks  = [s["length"] for s in streak_history if s["type"] == "win"]
    loss_streaks = [s["length"] for s in streak_history if s["type"] == "loss"]
    last         = streak_history[-1]

    return {
        "current_streak":      last["length"],
        "current_streak_type": last["type"],
        "best_win_streak":     max(win_streaks)  if win_streaks  else 0,
        "worst_loss_streak":   max(loss_streaks) if loss_streaks else 0,
        "longest_win_streak":  max(win_streaks)  if win_streaks  else 0,
        "longest_loss_streak": max(loss_streaks) if loss_streaks else 0,
        "streak_history":      streak_history[-20:]
    }

# ─────────────────────────────────────────
#  RISK / REWARD
# ─────────────────────────────────────────

@app.get("/analytics/risk-reward")
def get_risk_reward(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    account_id: Optional[str] = Query(None)
):
    all_account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    filter_ids = [account_id] if account_id and account_id in all_account_ids else all_account_ids
    trades = db.query(Trade).filter(Trade.account_id.in_(filter_ids)).all()

    per_trade      = []
    planned_ratios = []

    for t in trades:
        entry = {
            "id": t.id, "symbol": t.symbol,
            "profit": t.profit, "planned_rr": None, "realized_rr": None
        }

        if t.stop_loss is not None and t.take_profit is not None:
            risk   = abs(t.open_price - t.stop_loss)
            reward = abs(t.take_profit - t.open_price)
            if risk > 0:
                entry["planned_rr"] = round(reward / risk, 2)
                planned_ratios.append(entry["planned_rr"])

        if t.stop_loss is not None:
            risk     = abs(t.open_price - t.stop_loss)
            realized = abs(t.close_price - t.open_price)
            if risk > 0:
                entry["realized_rr"] = round(realized / risk, 2)

        per_trade.append(entry)

    trades_with_rr   = [t for t in per_trade if t["planned_rr"] is not None]
    avg_planned      = round(sum(planned_ratios) / len(planned_ratios), 2) if planned_ratios else 0
    wins_with_rr     = [t for t in trades_with_rr if t["profit"] > 0]
    win_rate_with_rr = round((len(wins_with_rr) / len(trades_with_rr)) * 100, 1) if trades_with_rr else 0

    return {
        "trades": per_trade,
        "summary": {
            "trades_with_rr_set":   len(trades_with_rr),
            "total_trades":         len(trades),
            "average_planned_rr":   avg_planned,
            "win_rate_on_rr_trades": win_rate_with_rr
        }
    }

# ─────────────────────────────────────────
#  MT5
# ─────────────────────────────────────────

def _mt5_unavailable():
    return {"status": "error", "message": "MT5 is not available on this server."}


@app.get("/mt5/account")
def get_mt5_account():
    if not MT5_AVAILABLE:
        return _mt5_unavailable()
    try:
        if not mt5.initialize():
            return {"status": "error", "message": "MT5 not connected"}
        account = mt5.account_info()
        if account is None:
            mt5.shutdown()
            return {"status": "error", "message": "No account logged in"}
        data = {
            "login": account.login, "server": account.server,
            "balance": account.balance, "equity": account.equity,
            "profit": account.profit, "margin": account.margin,
            "margin_free": account.margin_free, "currency": account.currency
        }
        mt5.shutdown()
        return data
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/mt5/sync")
def sync_mt5_trades(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if not MT5_AVAILABLE:
        return _mt5_unavailable()
    if not mt5.initialize():
        return {"status": "error", "message": "MT5 not connected"}

    from_date = datetime.now() - timedelta(days=3652)
    deals     = mt5.history_deals_get(from_date, datetime.now())

    if deals is None:
        mt5.shutdown()
        return {"status": "error", "message": "No history found"}

    user_accounts = db.query(Account).filter(Account.user_id == current_user["user_id"]).all()
    if not user_accounts:
        mt5.shutdown()
        return {"status": "error", "message": "No Voyager account linked"}

    account_id = user_accounts[0].id
    imported   = 0

    for deal in deals:
        if deal.entry != mt5.DEAL_ENTRY_OUT:
            continue
        existing = db.query(Trade).filter(Trade.ticket == str(deal.ticket)).first()
        if existing:
            continue
        trade = Trade(
            id=str(uuid.uuid4()), account_id=account_id,
            symbol=deal.symbol, order_type=str(deal.type),
            lot_size=deal.volume, open_price=deal.price,
            close_price=deal.price, profit=deal.profit,
            ticket=str(deal.ticket),
            created_at=datetime.fromtimestamp(deal.time)
        )
        db.add(trade)
        imported += 1

    db.commit()
    mt5.shutdown()
    return {"status": "success", "imported": imported}

# ─────────────────────────────────────────
#  FUNDAMENTALS
# ─────────────────────────────────────────

@app.get("/fundamentals")
async def get_fundamentals(current_user=Depends(get_current_user)):
    country_map = {
        "US": "USD", "XC": "EUR", "GB": "GBP",
        "JP": "JPY", "AU": "AUD", "CA": "CAD",
        "NZ": "NZD", "CH": "CHF", "SA": "ZAR"
    }

    country_codes = ";".join(country_map.keys())
    indicators    = {
        "gdp_growth":   "NY.GDP.MKTP.KD.ZG",
        "inflation":    "FP.CPI.TOTL.ZG",
        "unemployment": "SL.UEM.TOTL.ZS"
    }
    results = {code: {"code": code} for code in country_map.values()}

    async with httpx.AsyncClient() as client:
        for metric, indicator in indicators.items():
            try:
                res  = await client.get(
                    f"https://api.worldbank.org/v2/country/{country_codes}/indicator/{indicator}",
                    params={"format": "json", "mrv": 1, "per_page": 20},
                    timeout=30.0
                )
                data = res.json()
                if isinstance(data, list) and len(data) > 1 and data[1]:
                    for entry in data[1]:
                        country_id = entry["country"]["id"]
                        currency   = country_map.get(country_id)
                        value      = entry["value"]
                        if currency and value is not None:
                            results[currency][metric] = round(value, 2)
            except Exception as e:
                print(f"World Bank fetch failed for {metric}: {str(e)}")

    return list(results.values())


@app.get("/crypto/fundamentals")
async def get_crypto_fundamentals(current_user=Depends(get_current_user)):
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={
                    "ids": "bitcoin,ethereum,solana,ripple",
                    "vs_currencies": "usd",
                    "include_24hr_change": "true",
                    "include_market_cap": "true",
                    "include_24hr_vol": "true"
                },
                headers={"accept": "application/json"},
                timeout=30.0
            )
            data = res.json()

            if "status" in data:
                raise HTTPException(status_code=429, detail="Rate limited — try again in a minute")

            NAME_MAP = {
                "bitcoin":  ("BTC", "Bitcoin"),
                "ethereum": ("ETH", "Ethereum"),
                "solana":   ("SOL", "Solana"),
                "ripple":   ("XRP", "Ripple")
            }

            return [
                {
                    "code":       NAME_MAP[coin][0],
                    "name":       NAME_MAP[coin][1],
                    "price":      round(values.get("usd", 0), 2),
                    "change_24h": round(values.get("usd_24h_change", 0), 2),
                    "change_7d":  0,
                    "market_cap": round(values.get("usd_market_cap", 0), 0),
                    "volume_24h": round(values.get("usd_24h_vol", 0), 0),
                    "ath_distance": 0
                }
                for coin, values in data.items()
                if coin in NAME_MAP
            ]
        except HTTPException:
            raise
        except Exception as e:
            print(f"Crypto fetch error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/currency/strength")
async def get_currency_strength(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    currencies = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "ZAR"]

    async with httpx.AsyncClient() as client:
        try:
            res = await client.get("https://open.er-api.com/v6/latest/USD", timeout=10.0)

            if not res.text.strip():
                raise HTTPException(status_code=500, detail="Empty response")

            data  = res.json()
            rates = data.get("rates", {})
            rates["USD"] = 1.0

            prev_snapshot = _closest_snapshot(db, SNAPSHOT_TARGET_LOOKBACK)

            # store this pull for future comparisons
            db.add(CurrencySnapshot(id=str(uuid4()), rates=rates))
            db.commit()

            if not prev_snapshot:
                print("[currency-strength] no prev_snapshot — falling back", flush=True)
                if currency_strength_last_good["data"]:
                    print("[currency-strength] returning last_good cache", flush=True)
                    return currency_strength_last_good["data"]
                print("[currency-strength] no last_good either — returning neutral zeros", flush=True)
                return [
                    {"code": c, "score": 0, "raw": 0, "trend": "neutral"}
                    for c in currencies
                ]

            scores     = {c: 0.0 for c in currencies}
            pair_count = {c: 0 for c in currencies}
            prev_rates = prev_snapshot.rates

            for base in currencies:
                if base not in rates or base not in prev_rates:
                    continue
                for target in currencies:
                    if base == target:
                        continue
                    if target not in rates or target not in prev_rates:
                        continue

                    now_cross  = rates[target]      / rates[base]
                    prev_cross = prev_rates[target]  / prev_rates[base]

                    if prev_cross == 0:
                        continue

                    pct_change = ((now_cross - prev_cross) / prev_cross) * 100
                    scores[base]     += pct_change
                    pair_count[base] += 1

            avg_scores = {
                c: round(scores[c] / pair_count[c], 4) if pair_count[c] else 0
                for c in currencies
            }

            max_abs = max(abs(v) for v in avg_scores.values()) or 1

            result = [
                {
                    "code":  code,
                    "score": round((avg_scores[code] / max_abs) * 100, 1),
                    "raw":   avg_scores[code],
                    "trend": "bullish" if avg_scores[code] > 0.01 else "bearish" if avg_scores[code] < -0.01 else "neutral"
                }
                for code in currencies
            ]

            currency_strength_last_good["data"] = result
            return result

        except HTTPException:
            raise
        except Exception as e:
            print(f"Currency strength error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────
#  ASSET SCORECARD (Enhanced Edge Finder)
# ─────────────────────────────────────────

scorecard_cache = {}
SCORECARD_CACHE_TTL = 3600  # 1 hour


@app.get("/fundamentals/scorecard")
async def get_scorecard(
    asset: str = Query("USD"),
    current_user=Depends(get_current_user)
):
    """
    Returns a full scorecard for a given currency or metal.
    Sections: growth, inflation, jobs, cot, overall.
    """
    now     = time.time()
    cachekey = f"scorecard_{asset}"

    cached = scorecard_cache.get(cachekey)
    if cached and (now - cached["timestamp"]) < SCORECARD_CACHE_TTL:
        return cached["data"]

    # ── Pull economic calendar events ────────────────────────────────
    # Reuse existing calendar cache if warm
    calendar = economic_calendar_cache.get("data") or []

    def find_event(keywords: list, country: str):
        """Find most recent released event matching keywords for a country."""
        for ev in sorted(calendar, key=lambda e: e.get("date",""), reverse=True):
            if ev.get("country") != country:
                continue
            title = ev.get("event","").lower()
            if any(k.lower() in title for k in keywords):
                actual   = ev.get("actual","")
                forecast = ev.get("forecast","")
                if actual and actual not in ("", "—"):
                    return {
                        "actual":   actual,
                        "forecast": forecast,
                        "surprise": _calc_surprise(actual, forecast)
                    }
        return {"actual": "—", "forecast": "—", "surprise": None}

    def _calc_surprise(actual_str, forecast_str):
        try:
            a = float(str(actual_str).replace("%","").replace("K","000").replace("M","000000").replace("k","000").strip())
            f = float(str(forecast_str).replace("%","").replace("K","000").replace("M","000000").replace("k","000").strip())
            diff = round(a - f, 2)
            return diff
        except:
            return None

    def bias_from_surprise(surprise, invert=False):
        """Convert a surprise value to bullish/bearish/neutral."""
        if surprise is None:
            return "neutral"
        threshold = 0
        if invert:
            return "bearish" if surprise > threshold else "bullish" if surprise < threshold else "neutral"
        return "bullish" if surprise > threshold else "bearish" if surprise < threshold else "neutral"

    # ── Country code map ─────────────────────────────────────────────
    COUNTRY_MAP = {
        "USD": "USD", "EUR": "EUR", "GBP": "GBP",
        "JPY": "JPY", "AUD": "AUD", "CAD": "CAD",
        "NZD": "NZD", "CHF": "CHF"
    }

    INDEX = { "USD INDEX": "US INDEX", "NAS 100": "NAS 100", "S&P 500": "S&P 500"}

    METALS = {"XAU", "XAG", "XPT", "XCU"}
    is_metal = asset in METALS

    # ── Sections ─────────────────────────────────────────────────────

    if is_metal:
        # Metals use commodity-specific logic
        result = await _build_metal_scorecard(asset, calendar, find_event, _calc_surprise, bias_from_surprise)
    else:
        country = asset  # calendar uses currency code as country

        # Growth bias
        gdp_ev  = find_event(["GDP"], country)
        mfg_ev  = find_event(["Manufacturing PMI", "ISM Manufacturing"], country)
        svc_ev  = find_event(["Services PMI", "ISM Services", "ISM Non-Manufacturing"], country)
        ret_ev  = find_event(["Retail Sales"], country)
        conf_ev = find_event(["Consumer Confidence", "Consumer Sentiment"], country)

        growth_items = [
            {"label": "GDP Growth",         "data": gdp_ev,  "bias": bias_from_surprise(gdp_ev["surprise"])},
            {"label": "Manufacturing PMI",   "data": mfg_ev,  "bias": bias_from_surprise(mfg_ev["surprise"])},
            {"label": "Services PMI",        "data": svc_ev,  "bias": bias_from_surprise(svc_ev["surprise"])},
            {"label": "Retail Sales MoM",    "data": ret_ev,  "bias": bias_from_surprise(ret_ev["surprise"])},
            {"label": "Consumer Confidence", "data": conf_ev, "bias": bias_from_surprise(conf_ev["surprise"])},
        ]
        growth_score = _section_score(growth_items)

        # Inflation bias
        cpi_ev = find_event(["CPI", "Consumer Price Index"], country)
        ppi_ev = find_event(["PPI", "Producer Price"], country)
        pce_ev = find_event(["PCE"], country)

        inflation_items = [
            {"label": "CPI YoY",  "data": cpi_ev, "bias": bias_from_surprise(cpi_ev["surprise"])},
            {"label": "PPI YoY",  "data": ppi_ev, "bias": bias_from_surprise(ppi_ev["surprise"])},
            {"label": "PCE YoY",  "data": pce_ev, "bias": bias_from_surprise(pce_ev["surprise"])},
        ]
        inflation_score = _section_score(inflation_items)

        # Jobs bias
        nfp_ev    = find_event(["Non-Farm Payroll", "Employment Change", "NFP"], country)
        unemp_ev  = find_event(["Unemployment Rate"], country)
        claims_ev = find_event(["Jobless Claims", "Unemployment Claims"], country)
        adp_ev    = find_event(["ADP"], country)

        jobs_items = [
            {"label": "Employment",      "data": nfp_ev,   "bias": bias_from_surprise(nfp_ev["surprise"])},
            {"label": "Unemployment %",  "data": unemp_ev, "bias": bias_from_surprise(unemp_ev["surprise"], invert=True)},
            {"label": "Jobless Claims",  "data": claims_ev,"bias": bias_from_surprise(claims_ev["surprise"], invert=True)},
            {"label": "ADP Employment",  "data": adp_ev,   "bias": bias_from_surprise(adp_ev["surprise"])},
        ]
        jobs_score = _section_score(jobs_items)

        # COT bias (from DB if available)
        cot_data = await _get_cot_bias(asset)

        # Macro score from existing matrix
        macro_score = await _get_macro_score(asset)

        # Composite score
        weights = {
            "growth":    0.30,
            "inflation": 0.25,
            "jobs":      0.25,
            "cot":       0.20,
        }

        composite = round(
            growth_score    * weights["growth"]    +
            inflation_score * weights["inflation"] +
            jobs_score      * weights["jobs"]      +
            (cot_data.get("score", 0) or 0) * weights["cot"],
            2
        )

        # Overall bias label
        overall_bias = (
            "Very Bullish"  if composite >= 0.6  else
            "Bullish"       if composite >= 0.2  else
            "Very Bearish"  if composite <= -0.6 else
            "Bearish"       if composite <= -0.2 else
            "Neutral"
        )

        result = {
            "asset":        asset,
            "composite":    composite,
            "overall_bias": overall_bias,
            "macro_score":  macro_score,
            "sections": {
                "growth": {
                    "bias":  _section_bias(growth_score),
                    "score": growth_score,
                    "items": growth_items
                },
                "inflation": {
                    "bias":  _section_bias(inflation_score),
                    "score": inflation_score,
                    "items": inflation_items
                },
                "jobs": {
                    "bias":  _section_bias(jobs_score),
                    "score": jobs_score,
                    "items": jobs_items
                },
                "cot": cot_data
            }
        }

    scorecard_cache[cachekey] = {"data": result, "timestamp": now}
    return result


def _section_score(items: list) -> float:
    """Convert list of bias items to a score between -1 and +1."""
    mapping = {"bullish": 1, "neutral": 0, "bearish": -1}
    scores  = [mapping.get(i["bias"], 0) for i in items if i["data"]["actual"] != "—"]
    return round(sum(scores) / len(scores), 2) if scores else 0.0


def _section_bias(score: float) -> str:
    if score >= 0.5:  return "Very Bullish"
    if score >= 0.1:  return "Bullish"
    if score <= -0.5: return "Very Bearish"
    if score <= -0.1: return "Bearish"
    return "Neutral"


async def _get_cot_bias(currency: str) -> dict:
    """Pull latest COT positioning from DB."""
    db = SessionLocal()
    try:
        from models.cot import COTPosition
        rows = (
            db.query(COTPosition)
            .filter(COTPosition.currency == currency)
            .order_by(COTPosition.report_date.desc())
            .limit(2)
            .all()
        )
        if not rows:
            return {"has_data": False, "score": 0}

        current  = rows[0]
        previous = rows[1] if len(rows) > 1 else None

        net      = current.net_position
        oi       = current.open_interest or 1
        long_pct = round((current.large_spec_long  / oi) * 100, 1)
        short_pct= round((current.large_spec_short / oi) * 100, 1)
        change   = round(net - previous.net_position, 0) if previous else 0

        # Score: positive net = bullish, scaled to -1..+1
        score = max(-1, min(1, net / max(oi * 0.1, 1)))

        return {
            "has_data":    True,
            "net_position":net,
            "long_pct":    long_pct,
            "short_pct":   short_pct,
            "change":      change,
            "bias":        "bullish" if net > 0 else "bearish" if net < 0 else "neutral",
            "score":       round(score, 2)
        }
    except Exception as e:
        print(f"COT bias error: {e}")
        return {"has_data": False, "score": 0}
    finally:
        db.close()


async def _get_macro_score(currency: str) -> float:
    """Pull overall macro score from existing macro matrix cache."""
    try:
        matrix = macro_matrix_cache.get("data")
        if not matrix:
            policy_rates = await fetch_policy_rates()
            # don't re-trigger full matrix build — just return 0 if not cached
            return 0
        row = next((r for r in matrix["rows"] if r["currency"] == currency), None)
        return row["overall_score"] if row else 0
    except:
        return 0


async def _build_metal_scorecard(asset, calendar, find_event, _calc_surprise, bias_from_surprise) -> dict:
    METAL_NAMES = {
        "XAU": "Gold",
        "XAG": "Silver", 
        "XPT": "Platinum",
        "XCU": "Copper"
    }

    METAL_DRIVERS = {
        "XAU": ["Risk sentiment", "USD strength", "Inflation hedge", "Central bank buying"],
        "XAG": ["Industrial demand", "USD strength", "Inflation hedge", "Solar/EV demand"],
        "XPT": ["Auto catalysts", "Mining supply", "Industrial demand", "USD strength"],
        "XCU": ["China PMI", "Construction", "EV demand", "Mining supply"]
    }

    # safe cache access — don't crash if matrix hasn't been fetched yet
    matrix_data = macro_matrix_cache.get("data") or {}
    usd_rates   = matrix_data.get("rows", [])
    usd_row     = next((r for r in usd_rates if r["currency"] == "USD"), {})
    usd_rate    = usd_row.get("rate") or 0

    usd_cpi  = find_event(["CPI", "Consumer Price Index"], "USD")
    usd_nfp  = find_event(["Non-Farm Payroll", "NFP", "Employment Change"], "USD")
    usd_mfg  = find_event(["Manufacturing PMI", "ISM Manufacturing"], "USD")
    china_pmi= find_event(["Manufacturing PMI"], "CNY") if asset in ("XCU", "XPT") else {"actual":"—","forecast":"—","surprise":None}

    cpi_surprise = usd_cpi.get("surprise")
    cpi_bias     = "bullish" if (cpi_surprise or 0) > 0 else "bearish" if (cpi_surprise or 0) < 0 else "neutral"
    rate_bias    = "bearish" if usd_rate >= 4 else "neutral" if usd_rate >= 2 else "bullish"
    nfp_surprise = usd_nfp.get("surprise")
    nfp_bias     = "bearish" if (nfp_surprise or 0) > 0 else "bullish" if (nfp_surprise or 0) < 0 else "neutral"
    pmi_bias     = bias_from_surprise(china_pmi.get("surprise"))
    mfg_bias     = bias_from_surprise(usd_mfg.get("surprise"))

    if asset == "XAU":
        items = [
            {"label": "CPI Surprise (inflation hedge)", "data": usd_cpi,  "bias": cpi_bias},
            {"label": "USD Rate (opportunity cost)",    "data": {"actual": f"{usd_rate}%" if usd_rate else "—", "forecast": "—", "surprise": None}, "bias": rate_bias},
            {"label": "NFP (risk-off demand)",          "data": usd_nfp,  "bias": nfp_bias},
            {"label": "US Manufacturing PMI",           "data": usd_mfg,  "bias": mfg_bias},
        ]
    elif asset == "XAG":
        items = [
            {"label": "CPI Surprise (inflation hedge)", "data": usd_cpi,  "bias": cpi_bias},
            {"label": "USD Rate (opportunity cost)",    "data": {"actual": f"{usd_rate}%" if usd_rate else "—", "forecast": "—", "surprise": None}, "bias": rate_bias},
            {"label": "US Manufacturing PMI",           "data": usd_mfg,  "bias": mfg_bias},
            {"label": "NFP (industrial demand proxy)",  "data": usd_nfp,  "bias": nfp_bias},
        ]
    elif asset == "XPT":
        items = [
            {"label": "US Manufacturing PMI (auto)",    "data": usd_mfg,   "bias": mfg_bias},
            {"label": "China Manufacturing PMI",        "data": china_pmi, "bias": pmi_bias},
            {"label": "USD Rate (opportunity cost)",    "data": {"actual": f"{usd_rate}%" if usd_rate else "—", "forecast": "—", "surprise": None}, "bias": rate_bias},
            {"label": "CPI Surprise",                   "data": usd_cpi,   "bias": cpi_bias},
        ]
    else:  # XCU
        items = [
            {"label": "China Manufacturing PMI",        "data": china_pmi, "bias": pmi_bias},
            {"label": "US Manufacturing PMI",           "data": usd_mfg,   "bias": mfg_bias},
            {"label": "USD Rate (demand impact)",       "data": {"actual": f"{usd_rate}%" if usd_rate else "—", "forecast": "—", "surprise": None}, "bias": rate_bias},
            {"label": "NFP (construction demand)",      "data": usd_nfp,   "bias": nfp_bias},
        ]

    score        = _section_score(items)
    overall_bias = _section_bias(score)

    return {
        "asset":        asset,
        "name":         METAL_NAMES.get(asset, asset),
        "composite":    score,
        "overall_bias": overall_bias,
        "drivers":      METAL_DRIVERS.get(asset, []),
        "macro_score":  score,
        "sections": {
            "growth":    {"bias": overall_bias, "score": score, "items": items},
            "inflation": {"bias": cpi_bias,     "score": round((1 if cpi_bias=="bullish" else -1 if cpi_bias=="bearish" else 0), 2), "items": [{"label":"CPI","data":usd_cpi,"bias":cpi_bias}]},
            "jobs":      {"bias": nfp_bias,     "score": round((1 if nfp_bias=="bullish" else -1 if nfp_bias=="bearish" else 0), 2), "items": [{"label":"NFP","data":usd_nfp,"bias":nfp_bias}]},
            "cot":       {"has_data": False, "score": 0}
        }
    }



# ─────────────────────────────────────────
#  AI ENDPOINTS
# ─────────────────────────────────────────

@app.post("/ai/insight")
async def ai_insight(payload: dict, current_user=Depends(get_current_user)):
    prompt = payload.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="No prompt provided")

    cached = get_cached_response(prompt)
    if cached:
        return {"text": cached, "cached": True}

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.getenv('GROQ_API_KEY')}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "llama-3.1-8b-instant",
                    "max_tokens": 600,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=30.0
            )

        data = res.json()

        if "choices" not in data:
            print(f"Groq response: {data}")
            raise HTTPException(
                status_code=500,
                detail=f"Groq error: {data.get('error', {}).get('message', str(data))}"
            )

        text = data["choices"][0]["message"]["content"]
        set_cached_response(prompt, text)
        return {"text": text, "cached": False}

    except HTTPException:
        raise
    except Exception as e:
        print(f"AI insight error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ai/trade-insights")
async def ai_trade_insights(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    account_ids = [a.id for a in db.query(Account).filter(Account.user_id == current_user["user_id"]).all()]
    trades      = db.query(Trade).filter(Trade.account_id.in_(account_ids)).all()

    if not trades:
        raise HTTPException(status_code=404, detail="No trades found")

    symbol_stats = {}
    day_stats    = {}

    for trade in trades:
        if trade.symbol not in symbol_stats:
            symbol_stats[trade.symbol] = {"trades": 0, "wins": 0, "profit": 0.0}
        symbol_stats[trade.symbol]["trades"] += 1
        symbol_stats[trade.symbol]["profit"] += trade.profit
        if trade.profit > 0:
            symbol_stats[trade.symbol]["wins"] += 1

        day = trade.created_at.strftime("%A")
        if day not in day_stats:
            day_stats[day] = {"trades": 0, "wins": 0, "profit": 0.0}
        day_stats[day]["trades"] += 1
        day_stats[day]["profit"] += trade.profit
        if trade.profit > 0:
            day_stats[day]["wins"] += 1

    total_trades = len(trades)
    total_profit = round(sum(t.profit for t in trades), 2)
    win_rate     = round(len([t for t in trades if t.profit > 0]) / total_trades * 100, 1)

    symbol_summary = "; ".join([
        f"{s}: {v['trades']} trades, {round(v['wins']/v['trades']*100,1)}% WR, ${round(v['profit'],2)} PL"
        for s, v in sorted(symbol_stats.items(), key=lambda x: x[1]['profit'], reverse=True)[:8]
    ])

    day_summary = "; ".join([
        f"{d}: {v['trades']} trades, {round(v['wins']/v['trades']*100,1)}% WR, ${round(v['profit'],2)}"
        for d, v in day_stats.items()
    ])

    prompt = (
        "You are an expert trading coach. Give specific actionable insights based on this data. "
        f"Total trades: {total_trades}, Total profit: ${total_profit}, Win rate: {win_rate}%. "
        f"By symbol: {symbol_summary}. By day: {day_summary}. "
        "Return exactly 6 insights as a JSON array with no markdown, no preamble: "
        '[{"title": "Short title", "detail": "2-3 sentences with specific numbers", '
        '"type": "strength or weakness or opportunity or warning"}]. '
        "Return ONLY the JSON array."
    )

    cached = get_cached_response(prompt)
    if cached:
        clean    = cached.replace("```json", "").replace("```", "").strip()
        insights = json.loads(clean)
        return {"insights": insights, "summary": {
            "total_trades": total_trades,
            "total_profit": total_profit,
            "win_rate":     win_rate
        }, "cached": True}

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.getenv('GROQ_API_KEY')}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "llama-3.1-8b-instant",
                    "max_tokens": 1500,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=30.0
            )

        data = res.json()

        if "choices" not in data:
            raise HTTPException(status_code=500, detail=f"Groq error: {data}")

        text     = data["choices"][0]["message"]["content"]
        clean    = text.replace("```json", "").replace("```", "").strip()
        insights = json.loads(clean)

        set_cached_response(prompt, text)

        return {"insights": insights, "summary": {
            "total_trades": total_trades,
            "total_profit": total_profit,
            "win_rate":     win_rate
        }, "cached": False}

    except json.JSONDecodeError as e:
        print(f"JSON parse error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Could not parse AI response: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Trade insights error: {type(e).__name__}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")

# ── Economic calendar cache ──────────────────────────────────────────

economic_calendar_cache = {"data": None, "timestamp": 0}
ECONOMIC_CACHE_TTL = 3 * 3600       # 3 hours — reduces shared-IP rate-limit pressure
ECONOMIC_STALE_MAX_AGE = 24 * 3600


async def _fetch_calendar_once(client, url, headers):
    res = await client.get(url, timeout=15.0, headers=headers)

    if res.status_code == 429:
        return None, "rate_limited"
    if res.status_code != 200:
        print(f"Calendar fetch non-200: status={res.status_code}, body preview={res.text[:200]}")
        return None, "bad_status"
    if not res.text.strip():
        print("Calendar fetch empty body")
        return None, "empty_body"

    data = res.json()
    if not isinstance(data, list):
        print(f"Calendar fetch unexpected shape: {type(data)}")
        return None, "bad_shape"

    return data, None


@app.get("/economic/calendar")
async def get_economic_calendar(current_user=Depends(get_current_user)):

    now = time.time()

    if economic_calendar_cache["data"] and (now - economic_calendar_cache["timestamp"]) < ECONOMIC_CACHE_TTL:
        print("Economic calendar cache hit")
        return economic_calendar_cache["data"]

    # ForexFactory deprecated lastweek/nextweek and rate-limits weekly
    # calendar downloads per IP — only fetch what's still supported,
    # once per cycle, with a single short retry on 429.
    url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
    majors = {"USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "ZAR"}

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
    }

    events = []

    async with httpx.AsyncClient() as client:
        try:
            events, reason = await _fetch_calendar_once(client, url, headers)

            retry_delays = [5, 15, 30]
            for delay in retry_delays:
                if events is not None or reason != "rate_limited":
                    break
                print(f"Calendar fetch rate-limited (429) — retrying in {delay}s")
                await asyncio.sleep(delay)
                events, reason = await _fetch_calendar_once(client, url, headers)

            if events is None:
                print(f"Calendar fetch failed after all retries: {reason}")
                events = []

        except Exception as e:
            print(f"Calendar fetch failed: {str(e)}")
            events = []

    if not events:
        if economic_calendar_cache["data"] and (now - economic_calendar_cache["timestamp"]) < ECONOMIC_STALE_MAX_AGE:
            print("Fetch failed — serving stale cached data")
            return economic_calendar_cache["data"]
        print("Fetch failed and no usable cache — returning empty list")
        return []

    usd_actuals = await get_cached_usd_actuals()

    cleaned = []
    seen    = set()

    for e in events:
        country = e.get("country", "")
        impact  = e.get("impact", "")

        if country not in majors:
            continue
        if impact not in ("High", "Medium"):
            continue

        key = (e.get("title", ""), country, e.get("date", ""))
        if key in seen:
            continue
        seen.add(key)

        actual_value = e.get("actual", "") or ""

        # Backfill USD actuals from FRED when the free calendar leaves it blank
        if country == "USD" and not actual_value:
            metric_key = match_event_to_metric(e.get("title", ""))
            if metric_key and usd_actuals.get(metric_key):
                metric = usd_actuals[metric_key]
                event_date = e.get("date", "")[:10]
                # only backfill if the FRED data point is from on/around this event's date,
                # so we don't attach a stale reading to the wrong release
                if metric["date"][:7] == event_date[:7]:  # same year-month
                    actual_value = f"{metric['value']}{metric['unit']}"

        cleaned.append({
            "event":    e.get("title", ""),
            "country":  country,
            "impact":   impact.lower(),
            "actual":   actual_value,
            "forecast": e.get("forecast", "") or "",
            "previous": e.get("previous", "") or "",
            "date":     e.get("date", "")
        })

    cleaned.sort(key=lambda x: x["date"])

    economic_calendar_cache["data"]      = cleaned
    economic_calendar_cache["timestamp"] = now
    save_persistent_cache("economic_calendar", cleaned)

    from utils.fred_actuals import fetch_usd_actuals, match_event_to_metric

    usd_actuals_cache = {"data": None, "timestamp": 0}
    USD_ACTUALS_CACHE_TTL = 6 * 3600  # 6 hours — FRED data doesn't change intraday

    async def get_cached_usd_actuals():
        now = time.time()
        if usd_actuals_cache["data"] and (now - usd_actuals_cache["timestamp"]) < USD_ACTUALS_CACHE_TTL:
            return usd_actuals_cache["data"]
        data = await fetch_usd_actuals()
        usd_actuals_cache["data"] = data
        usd_actuals_cache["timestamp"] = now
        return data

    return cleaned

# ─────────────────────────────────────────
#  GOALS
# ─────────────────────────────────────────

@app.post("/goals")
def set_goal(
    goal: GoalCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    month = datetime.utcnow().strftime("%Y-%m")

    existing = db.query(Goal).filter(
        Goal.user_id == current_user["user_id"],
        Goal.month == month
    ).first()

    if existing:
        existing.target_profit = goal.target_profit
        existing.target_trades = goal.target_trades
        db.commit()
        return {"message": "Goal updated"}

    new_goal = Goal(
        id=str(uuid.uuid4()),
        user_id=current_user["user_id"],
        month=month,
        target_profit=goal.target_profit,
        target_trades=goal.target_trades
    )
    db.add(new_goal)
    db.commit()
    return {"message": "Goal set"}


@app.get("/goals/current")
def get_current_goal(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    now   = datetime.utcnow()
    month = now.strftime("%Y-%m")

    goal = db.query(Goal).filter(
        Goal.user_id == current_user["user_id"],
        Goal.month == month
    ).first()

    account_ids = [
        a.id for a in
        db.query(Account).filter(Account.user_id == current_user["user_id"]).all()
    ]
    trades = db.query(Trade).filter(Trade.account_id.in_(account_ids)).all()

    month_trades  = [t for t in trades if t.created_at.strftime("%Y-%m") == month]
    actual_profit = round(sum(t.profit for t in month_trades), 2)
    actual_trades = len(month_trades)
    wins          = len([t for t in month_trades if t.profit > 0])
    actual_win_rate = round((wins / actual_trades) * 100, 1) if actual_trades > 0 else 0

    days_in_month = calendar.monthrange(now.year, now.month)[1]
    day_of_month  = now.day
    days_remaining = days_in_month - day_of_month

    if not goal:
        return {
            "has_goal":        False,
            "month":           month,
            "actual_profit":   actual_profit,
            "actual_trades":   actual_trades,
            "actual_win_rate": actual_win_rate,
            "days_remaining":  days_remaining
        }

    progress_pct = round((actual_profit / goal.target_profit) * 100, 1) if goal.target_profit > 0 else 0
    trades_progress_pct = (
        round((actual_trades / goal.target_trades) * 100, 1)
        if goal.target_trades else None
    )

    expected_pace = (day_of_month / days_in_month) * 100

    return {
        "has_goal":            True,
        "month":               month,
        "target_profit":       goal.target_profit,
        "target_trades":       goal.target_trades,
        "actual_profit":       actual_profit,
        "actual_trades":       actual_trades,
        "actual_win_rate":     actual_win_rate,
        "progress_pct":        progress_pct,
        "trades_progress_pct": trades_progress_pct,
        "days_remaining":      days_remaining,
        "on_track":            progress_pct >= expected_pace
    }


@app.get("/goals/history")
def get_goal_history(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    goals = db.query(Goal).filter(
        Goal.user_id == current_user["user_id"]
    ).order_by(Goal.month.desc()).all()

    account_ids = [
        a.id for a in
        db.query(Account).filter(Account.user_id == current_user["user_id"]).all()
    ]
    trades = db.query(Trade).filter(Trade.account_id.in_(account_ids)).all()

    results = []
    for g in goals:
        month_trades  = [t for t in trades if t.created_at.strftime("%Y-%m") == g.month]
        actual_profit = round(sum(t.profit for t in month_trades), 2)

        results.append({
            "month":         g.month,
            "target_profit": g.target_profit,
            "actual_profit": actual_profit,
            "achieved":      actual_profit >= g.target_profit,
            "progress_pct":  round((actual_profit / g.target_profit) * 100, 1) if g.target_profit > 0 else 0
        })

    return results

#__--
#Correlation cache — Frankfurter-based (Stooq blocked Render's IP)
#_____
correlation_cache    = {}
CORRELATION_CACHE_TTL = 21600  # 6 hours — daily data doesn't need refreshing often

def pearson_correlation(x, y):
    n = len(x)
    if n == 0:
        return 0
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    cov    = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))
    std_x  = (sum((xi - mean_x) ** 2 for xi in x)) ** 0.5
    std_y  = (sum((yi - mean_y) ** 2 for yi in y)) ** 0.5
    if std_x == 0 or std_y == 0:
        return 0
    return cov / (std_x * std_y)

@app.get("/correlation/matrix")
async def get_correlation_matrix(
    current_user=Depends(get_current_user),
    days: int = Query(30, ge=10, le=90)
):
    print(f"=== Correlation matrix endpoint hit, days={days} ===", flush=True)

    cached = correlation_cache.get(days)
    if cached and (time.time() - cached["timestamp"]) < CORRELATION_CACHE_TTL:
        print("Correlation cache hit", flush=True)
        return cached["data"]

    end_date   = datetime.utcnow().date()
    # buffer for weekends/holidays — fetch extra days to guarantee enough trading days
    fetch_days = days + 20
    start_date = end_date - timedelta(days=fetch_days)
    targets    = "EUR,GBP,JPY,CHF,AUD,CAD,NZD,ZAR"

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            res = await client.get(
                f"https://api.frankfurter.app/{start_date.isoformat()}..{end_date.isoformat()}",
                params={"from": "USD", "to": targets},
                timeout=20.0
            )

            if res.status_code != 200:
                print(f"Frankfurter non-200: status={res.status_code}, body={res.text[:200]}", flush=True)
                raise HTTPException(status_code=500, detail="Could not fetch historical price data")

            data        = res.json()
            daily_rates = data.get("rates", {})

        if not daily_rates:
            raise HTTPException(status_code=500, detail="Could not fetch historical price data")

        # take last `days` trading days worth of data
        sorted_dates = sorted(daily_rates.keys())[-days:]

        pair_series = {
            "EURUSD": [], "GBPUSD": [], "USDJPY": [], "USDCHF": [],
            "AUDUSD": [], "USDCAD": [], "NZDUSD": [], "EURGBP": [],
            "EURJPY": [], "GBPJPY": [], "USDZAR":[]
        }

        for date in sorted_dates:
            r = daily_rates[date]
            if not all(c in r for c in ["EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "ZAR"]):
                continue

            eurusd = 1 / r["EUR"]
            gbpusd = 1 / r["GBP"]
            usdjpy = r["JPY"]
            usdchf = r["CHF"]
            audusd = 1 / r["AUD"]
            usdcad = r["CAD"]
            nzdusd = 1 / r["NZD"]
            usdzar = r["ZAR"]

            pair_series["EURUSD"].append(eurusd)
            pair_series["GBPUSD"].append(gbpusd)
            pair_series["USDJPY"].append(usdjpy)
            pair_series["USDCHF"].append(usdchf)
            pair_series["AUDUSD"].append(audusd)
            pair_series["USDCAD"].append(usdcad)
            pair_series["NZDUSD"].append(nzdusd)
            pair_series["EURGBP"].append(eurusd / gbpusd)
            pair_series["EURJPY"].append(eurusd * usdjpy)
            pair_series["GBPJPY"].append(gbpusd * usdjpy)
            pair_series["USDZAR"].append(usdzar)

        returns = {}
        for pair, series in pair_series.items():
            rets = []
            for i in range(1, len(series)):
                if series[i - 1] != 0:
                    rets.append((series[i] - series[i - 1]) / series[i - 1])
            returns[pair] = rets

        valid_pairs = [p for p in returns if len(returns[p]) >= 10]

        if not valid_pairs:
            print("No valid pairs after processing", flush=True)
            raise HTTPException(status_code=500, detail="Could not fetch historical price data")

        min_len = min(len(returns[p]) for p in valid_pairs)

        matrix = []
        for p1 in valid_pairs:
            row = []
            r1  = returns[p1][-min_len:]
            for p2 in valid_pairs:
                r2   = returns[p2][-min_len:]
                corr = pearson_correlation(r1, r2)
                row.append(round(corr, 2))
            matrix.append(row)

        # ── Single currency correlations ──────────────────────────────
        # For each base currency, compute its correlation with every other
        # major currency using the direct USD-base rates from Frankfurter.

        currency_series = {
            "USD": [], "EUR": [], "GBP": [], "JPY": [],
            "CHF": [], "AUD": [], "CAD": [], "NZD": [],
            "ZAR":[]
        }

        for date in sorted_dates:
            r = daily_rates[date]
            if not all(c in r for c in ["EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "ZAR"]):
                continue
            # express each currency vs USD
            currency_series["USD"].append(1.0)
            currency_series["EUR"].append(1 / r["EUR"])
            currency_series["GBP"].append(1 / r["GBP"])
            currency_series["JPY"].append(1 / r["JPY"])
            currency_series["CHF"].append(1 / r["CHF"])
            currency_series["AUD"].append(1 / r["AUD"])
            currency_series["CAD"].append(1 / r["CAD"])
            currency_series["NZD"].append(1 / r["NZD"])
            currency_series["ZAR"].append(1 / r["ZAR"])

        # compute daily returns per currency
        currency_returns = {}
        for ccy, series in currency_series.items():
            rets = []
            for i in range(1, len(series)):
                if series[i - 1] != 0:
                    rets.append((series[i] - series[i - 1]) / series[i - 1])
            currency_returns[ccy] = rets

        currencies = [c for c in currency_returns if len(currency_returns[c]) >= 10]
        ccy_min    = min(len(currency_returns[c]) for c in currencies)

        single_corr = {}
        for base in currencies:
            single_corr[base] = {}
            r1 = currency_returns[base][-ccy_min:]
            for target in currencies:
                if base == target:
                    single_corr[base][target] = 1.0
                    continue
                r2   = currency_returns[target][-ccy_min:]
                corr = pearson_correlation(r1, r2)
                single_corr[base][target] = round(corr, 2)

        result = {
            "pairs":       valid_pairs,
            "matrix":      matrix,
            "single_corr": single_corr,
            "days":        days
        }

        correlation_cache[days] = {
            "data":      result,
            "timestamp": time.time()
        }

        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"FULL TRACEBACK: {traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")

# ─────────────────────────────────────────
#  WEEKLY CHALLENGES
# ─────────────────────────────────────────

WEEKLY_CHALLENGES = [
    {"rule_type": "no_loss_streak",    "rule_value": 3,    "description": "Don't have a loss streak longer than 3 trades this week."},
    {"rule_type": "journal_every_trade","rule_value": 1.0, "description": "Journal every trade you take this week."},
    {"rule_type": "win_rate",          "rule_value": 55.0, "description": "Finish the week with a win rate above 55%."},
    {"rule_type": "trade_limit",       "rule_value": 10.0, "description": "Take no more than 10 trades this week — quality over quantity."},
    {"rule_type": "profit_target",     "rule_value": 50.0, "description": "Hit at least $50 profit this week."},
]

def _current_week_key():
    now = datetime.utcnow()
    week_num = now.isocalendar()[1]
    return f"{now.year}-W{week_num:02d}"


def _get_or_create_challenge(db: Session, user_id: str) -> UserChallenge:
    week = _current_week_key()
    existing = db.query(UserChallenge).filter(
        UserChallenge.user_id == user_id,
        UserChallenge.week == week
    ).first()

    if existing:
        return existing

    # rotate based on week number so everyone gets the same challenge
    week_num = datetime.utcnow().isocalendar()[1]
    challenge_def = WEEKLY_CHALLENGES[week_num % len(WEEKLY_CHALLENGES)]

    new = UserChallenge(
        id=str(uuid4()),
        user_id=user_id,
        week=week,
        rule_type=challenge_def["rule_type"],
        rule_value=challenge_def["rule_value"],
        description=challenge_def["description"],
        achieved=False
    )
    db.add(new)
    db.commit()
    db.refresh(new)
    return new


def _evaluate_challenge(challenge: UserChallenge, trades, journals) -> bool:
    now    = datetime.utcnow()
    monday = now - timedelta(days=now.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)

    week_trades  = [t for t in trades  if t.created_at >= monday]
    week_journals = [j for j in journals if hasattr(j, 'created_at') and j.created_at and j.created_at >= monday]

    rule  = challenge.rule_type
    value = challenge.rule_value

    if rule == "no_loss_streak":
        # check max consecutive losses this week
        max_loss = current_loss = 0
        for t in sorted(week_trades, key=lambda x: x.created_at):
            if t.profit < 0:
                current_loss += 1
                max_loss = max(max_loss, current_loss)
            else:
                current_loss = 0
        return max_loss < value

    elif rule == "journal_every_trade":
        if not week_trades:
            return False
        return len(week_journals) >= len(week_trades)

    elif rule == "win_rate":
        if not week_trades:
            return False
        wins = len([t for t in week_trades if t.profit > 0])
        return (wins / len(week_trades)) * 100 >= value

    elif rule == "trade_limit":
        return len(week_trades) <= value

    elif rule == "profit_target":
        return sum(t.profit for t in week_trades) >= value

    return False


@app.get("/challenges/current")
def get_current_challenge(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user["user_id"]

    account_ids = [a.id for a in db.query(Account).filter(Account.user_id == user_id).all()]
    trades      = db.query(Trade).filter(Trade.account_id.in_(account_ids)).all()
    journals    = db.query(Journal).filter(Journal.user_id == user_id).all()

    challenge = _get_or_create_challenge(db, user_id)
    achieved  = _evaluate_challenge(challenge, trades, journals)

    if achieved and not challenge.achieved:
        challenge.achieved = True
        db.commit()

    now    = datetime.utcnow()
    monday = now - timedelta(days=now.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    week_trades = [t for t in trades if t.created_at >= monday]

    # build progress context
    progress = None
    if challenge.rule_type == "win_rate" and week_trades:
        wins = len([t for t in week_trades if t.profit > 0])
        progress = round((wins / len(week_trades)) * 100, 1)
    elif challenge.rule_type == "profit_target":
        progress = round(sum(t.profit for t in week_trades), 2)
    elif challenge.rule_type == "trade_limit":
        progress = len(week_trades)
    elif challenge.rule_type == "journal_every_trade":
        week_journals = [j for j in journals if hasattr(j, 'created_at') and j.created_at and j.created_at >= monday]
        progress = f"{len(week_journals)}/{len(week_trades)}"
    elif challenge.rule_type == "no_loss_streak":
        max_loss = current_loss = 0
        for t in sorted(week_trades, key=lambda x: x.created_at):
            if t.profit < 0:
                current_loss += 1
                max_loss = max(max_loss, current_loss)
            else:
                current_loss = 0
        progress = max_loss

    days_until_reset = 7 - datetime.utcnow().weekday()

    return {
        "week":             challenge.week,
        "rule_type":        challenge.rule_type,
        "rule_value":       challenge.rule_value,
        "description":      challenge.description,
        "achieved":         achieved,
        "progress":         progress,
        "days_until_reset": days_until_reset,
        "week_trades":      len(week_trades)
    }


@app.get("/challenges/history")
def get_challenge_history(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    challenges = db.query(UserChallenge).filter(
        UserChallenge.user_id == current_user["user_id"]
    ).order_by(UserChallenge.week.desc()).all()

    return [
        {
            "week":        c.week,
            "description": c.description,
            "achieved":    c.achieved
        }
        for c in challenges
    ]

#--------
#  MACRO MATRIX

#  POLICY RATES — hybrid auto + fallback
# Fallback rates for CBs without free machine-readable APIs
# Only needs updating when these CBs actually change rates

policy_rates_cache = {"data": None, "timestamp": 0}
POLICY_RATES_CACHE_TTL = 6 * 3600  # 6 hours

POLICY_RATES_FALLBACK = {
    "JPY": {"rate": 0.50, "stance": "hiking",  "trend": "hiking"},
    "AUD": {"rate": 3.85, "stance": "cutting", "trend": "cutting"},
    "CAD": {"rate": 2.75, "stance": "hold",    "trend": "cutting"},
    "NZD": {"rate": 3.25, "stance": "cutting", "trend": "cutting"},
    "CHF": {"rate": 0.00, "stance": "hold",    "trend": "neutral"},
    "ZAR": {"rate": 7.50, "stance": "cutting", "trend": "cutting"},
}

def _derive_stance(current: float, previous: float) -> dict:
    """Derive stance and trend from current vs previous rate."""
    if current > previous:
        return {"stance": "hiking",  "trend": "hiking"}
    if current < previous:
        return {"stance": "cutting", "trend": "cutting"}
    return {"stance": "hold", "trend": "neutral"}


async def _fetch_fred_rate(client: httpx.AsyncClient, series_id: str) -> float | None:
    """Fetch latest value for a FRED series."""
    fred_key = os.getenv("FRED_API_KEY")
    if not fred_key:
        return None
    try:
        res = await client.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id":        series_id,
                "api_key":          fred_key,
                "file_type":        "json",
                "sort_order":       "desc",
                "observation_start": "2023-01-01",
                "limit":            2
            },
            timeout=15.0
        )
        data = res.json()
        obs  = [o for o in data.get("observations", []) if o.get("value") != "."]
        if len(obs) >= 1:
            current  = round(float(obs[0]["value"]), 2)
            previous = round(float(obs[1]["value"]), 2) if len(obs) >= 2 else current
            return current, previous
    except Exception as e:
        print(f"FRED fetch failed for {series_id}: {str(e)}")
    return None, None


async def _fetch_ecb_rate(client: httpx.AsyncClient) -> tuple:
    """Fetch ECB deposit facility rate from ECB SDMX API."""
    try:
        res = await client.get(
            "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV",
            params={"format": "jsondata", "lastNObservations": 2},
            headers={"Accept": "application/json"},
            timeout=15.0,
            follow_redirects=True
        )
        data  = res.json()
        obs   = data["dataSets"][0]["series"]["0:0:0:0:0:0:0"]["observations"]
        dates = sorted(obs.keys(), key=lambda x: int(x), reverse=True)
        current  = round(float(obs[dates[0]][0]), 2)
        previous = round(float(obs[dates[1]][0]), 2) if len(dates) >= 2 else current
        return current, previous
    except Exception as e:
        print(f"ECB rate fetch failed: {str(e)}")
        return None, None


async def _fetch_boe_rate(client: httpx.AsyncClient) -> tuple:
    try:
        res = await client.get(
            "https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp",
            params={
                "csv.x":     "yes",
                "Datefrom":  "01/Jan/2023",
                "Dateto":    "now",
                "SeriesCodes": "IUMABEDR",
                "CSVF":      "TN",
                "UsingCodes": "Y"
            },
            timeout=15.0,
            follow_redirects=True
        )

        print(f"BoE raw response preview: {res.text[:300]}", flush=True)

        lines = [l.strip() for l in res.text.strip().split("\n") if l.strip()]

        # skip any header lines — data rows start with a date-like value
        data_rows = []
        for line in lines:
            parts = line.split(",")
            if len(parts) >= 2:
                try:
                    float(parts[1].strip())
                    data_rows.append(parts)
                except ValueError:
                    continue  # skip header/non-numeric rows

        if len(data_rows) >= 1:
            current  = round(float(data_rows[-1][1].strip()), 2)
            previous = round(float(data_rows[-2][1].strip()), 2) if len(data_rows) >= 2 else current
            return current, previous

    except Exception as e:
        print(f"BoE rate fetch failed: {str(e)}", flush=True)
    return None, None


async def fetch_policy_rates() -> dict:
    """
    Fetch policy rates from official free sources:
    - USD: FRED (DFF series — effective federal funds rate)
    - EUR: ECB SDMX API (deposit facility rate)
    - GBP: BoE Open Data API
    - Others: hardcoded fallback (updated manually when CBs change)
    Returns dict keyed by currency code.
    """
    now = time.time()

    if policy_rates_cache["data"] and (now - policy_rates_cache["timestamp"]) < POLICY_RATES_CACHE_TTL:
        return policy_rates_cache["data"]

    rates = {}

    async with httpx.AsyncClient(follow_redirects=True) as client:

        # ── USD via FRED ──────────────────────────────────────────
        usd_current, usd_prev = await _fetch_fred_rate(client, "DFEDTARU")
        if usd_current is not None:
            stance = _derive_stance(usd_current, usd_prev)
            rates["USD"] = {"rate": usd_current, **stance}
            print(f"USD rate fetched from FRED: {usd_current}%", flush=True)
        else:
            rates["USD"] = {"rate": 3.75, "stance": "hold", "trend": "cutting"}
            print("USD rate: using fallback", flush=True)

        # ── EUR via ECB ───────────────────────────────────────────
        eur_current, eur_prev = await _fetch_ecb_rate(client)
        if eur_current is not None:
            stance = _derive_stance(eur_current, eur_prev)
            rates["EUR"] = {"rate": eur_current, **stance}
            print(f"EUR rate fetched from ECB: {eur_current}%", flush=True)
        else:
            rates["EUR"] = {"rate": 2.15, "stance": "cutting", "trend": "cutting"}
            print("EUR rate: using fallback", flush=True)

        # ── GBP via BoE ───────────────────────────────────────────
        gbp_current, gbp_prev = await _fetch_boe_rate(client)
        if gbp_current is not None:
            stance = _derive_stance(gbp_current, gbp_prev)
            rates["GBP"] = {"rate": gbp_current, **stance}
            print(f"GBP rate fetched from BoE: {gbp_current}%", flush=True)
        else:
            rates["GBP"] = {"rate": 4.25, "stance": "cutting", "trend": "cutting"}
            print("GBP rate: using fallback", flush=True)

    # ── Remaining CBs — hardcoded fallback ────────────────────────
    for ccy, data in POLICY_RATES_FALLBACK.items():
        rates[ccy] = data

    policy_rates_cache["data"]      = rates
    policy_rates_cache["timestamp"] = now

    return rates

macro_matrix_cache = {"data": None, "timestamp": 0}
MACRO_CACHE_TTL    = 12 * 3600  # 12 hours

@app.get("/macro/matrix")
async def get_macro_matrix(current_user=Depends(get_current_user)):

    now = time.time()

    if macro_matrix_cache["data"] and (now - macro_matrix_cache["timestamp"]) < MACRO_CACHE_TTL:
        print("Macro matrix cache hit", flush=True)
        return macro_matrix_cache["data"]

    # fetch live policy rates (auto where available, fallback otherwise)
    policy_rates = await fetch_policy_rates()

    country_map = {
        "US": "USD", "XC": "EUR", "GB": "GBP",
        "JP": "JPY", "AU": "AUD", "CA": "CAD",
        "NZ": "NZD", "CH": "CHF", "ZA": "ZAR"
    }

    country_codes = ";".join(country_map.keys())

    indicators = {
        "cpi":             "FP.CPI.TOTL.ZG",
        "gdp_growth":      "NY.GDP.MKTP.KD.ZG",
        "unemployment":    "SL.UEM.TOTL.ZS",
        "current_account": "BN.CAB.XOKA.GD.ZS"
    }

    wb_data = {code: {} for code in country_map.values()}

    async with httpx.AsyncClient() as client:
        for metric, indicator in indicators.items():
            try:
                res = await client.get(
                    f"https://api.worldbank.org/v2/country/{country_codes}/indicator/{indicator}",
                    params={"format": "json", "mrv": 1, "per_page": 20},
                    timeout=30.0
                )
                data = res.json()
                if isinstance(data, list) and len(data) > 1 and data[1]:
                    for entry in data[1]:
                        ccy   = country_map.get(entry["country"]["id"])
                        value = entry["value"]
                        if ccy and value is not None:
                            wb_data[ccy][metric] = round(value, 2)
            except Exception as e:
                print(f"World Bank fetch failed for {metric}: {str(e)}")

    currencies = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "ZAR"]
    rows = []

    for ccy in currencies:
        wb  = wb_data.get(ccy, {})
        pol = policy_rates.get(ccy, {})

        cpi          = wb.get("cpi")
        gdp          = wb.get("gdp_growth")
        unemployment = wb.get("unemployment")
        current_acc  = wb.get("current_account")
        rate         = pol.get("rate")
        stance       = pol.get("stance", "unknown")
        trend        = pol.get("trend",  "neutral")

        def score_rate(r):
            if r is None: return None
            if r >= 4.0:  return 2
            if r >= 2.0:  return 1
            if r >= 0.5:  return 0
            return -1

        def score_cpi(c):
            if c is None: return None
            if 1.5 <= c <= 3.0: return 1
            if c > 5.0:         return -2
            if c > 3.0:         return -1
            return 0

        def score_gdp(g):
            if g is None: return None
            if g >= 3.0:  return 2
            if g >= 1.5:  return 1
            if g >= 0.0:  return 0
            return -1

        def score_unemployment(u):
            if u is None: return None
            if u <= 4.0:  return 2
            if u <= 5.5:  return 1
            if u <= 7.0:  return 0
            return -1

        def score_current_acc(c):
            if c is None: return None
            if c >= 2.0:  return 2
            if c >= 0.0:  return 1
            return -1

        scores = [
            score_rate(rate),
            score_cpi(cpi),
            score_gdp(gdp),
            score_unemployment(unemployment),
            score_current_acc(current_acc)
        ]

        valid_scores = [s for s in scores if s is not None]
        overall = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else 0

        rows.append({
            "currency":        ccy,
            "rate":            rate,
            "rate_stance":     stance,
            "rate_trend":      trend,
            "cpi":             cpi,
            "gdp":             gdp,
            "unemployment":    unemployment,
            "current_account": current_acc,
            "scores": {
                "rate":            score_rate(rate),
                "cpi":             score_cpi(cpi),
                "gdp":             score_gdp(gdp),
                "unemployment":    score_unemployment(unemployment),
                "current_account": score_current_acc(current_acc)
            },
            "overall_score": overall,
            "rate_source": (
                "FRED" if ccy == "USD" else
                "ECB"  if ccy == "EUR" else
                "BoE"  if ccy == "GBP" else
                "manual"
            )
        })

    rows.sort(key=lambda x: x["overall_score"], reverse=True)

    result = {
        "rows":       rows,
        "updated_at": datetime.utcnow().isoformat()
    }

    macro_matrix_cache["data"]      = result
    macro_matrix_cache["timestamp"] = now

    return result

# COT DATA
from models.cot import COTPosition
from utils.cftc_fetcher import fetch_latest_cot, is_stale
from datetime import date

@app.get("/cot/positioning")
def get_cot_positioning(db: Session = Depends(get_db), user=Depends(get_current_user)):

    all_currencies = ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "USD", "XAU", "XAG", "XPT", "XCU", "BTC", "ETH"]

    # rest of the endpoint stays exactly the same...
    results = []

    for ccy in all_currencies:
        history = (
            db.query(COTPosition)
            .filter(COTPosition.currency == ccy)
            .order_by(COTPosition.report_date.desc())
            .limit(52)
            .all()
        )

        if not history:
            results.append({
                "currency": ccy,
                "has_data": False
            })
            continue

        history = list(reversed(history))  # oldest → newest for sparkline
        current = history[-1]

        net_positions = [h.net_position for h in history]

        MIN_WEEKS_FOR_PERCENTILE = 8  # need a meaningful sample before ranking

        if len(net_positions) >= MIN_WEEKS_FOR_PERCENTILE:
            rank_count = sum(1 for n in net_positions if n <= current.net_position)
            percentile = round((rank_count / len(net_positions)) * 100)

            signal = None
            if percentile >= 80:
                signal = "extreme_long"
            elif percentile <= 20:
                signal = "extreme_short"
        else:
            percentile = None
            signal = None

        results.append({
            "currency":         ccy,
            "has_data":         True,
            "report_date":      current.report_date.isoformat(),
            "net_position":     current.net_position,
            "open_interest":    current.open_interest,
            "percentile_rank":  percentile,
            "signal":           signal,
            "weeks_of_history": len(net_positions),
            "sparkline":        net_positions[-52:],
            "large_spec_long":  current.large_spec_long,
            "large_spec_short": current.large_spec_short,
        })

    return {"positions": results, "updated": date.today().isoformat()}

# ....
from utils.cftc_backfill import backfill_cot_history

@app.post("/cot/backfill-history")
def trigger_cot_backfill(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = backfill_cot_history()

    inserted = 0
    for row in rows:
        exists = (
            db.query(COTPosition)
            .filter(
                COTPosition.currency == row["currency"],
                COTPosition.report_date == row["report_date"]
            )
            .first()
        )
        if not exists:
            db.add(COTPosition(**row))
            inserted += 1

    db.commit()

    return {
        "status": "backfill complete",
        "rows_found": len(rows),
        "rows_inserted": inserted
    }


@app.get("/cot/debug-contracts")
def debug_contract_names(user=Depends(get_current_user)):
    import httpx
    from utils.cftc_fetcher import DISAGGREGATED_URL, TFF_URL

    with httpx.Client(timeout=20) as client:
        metals_res = client.get(DISAGGREGATED_URL, params={"$limit": "20", "$order": "report_date_as_yyyy_mm_dd DESC"})
        crypto_res = client.get(TFF_URL, params={"$limit": "20", "$order": "report_date_as_yyyy_mm_dd DESC"})

    metals_names = sorted(set(e.get("market_and_exchange_names", "") for e in metals_res.json()))
    crypto_names = sorted(set(e.get("market_and_exchange_names", "") for e in crypto_res.json()))

    return {"metals_sample": metals_names, "crypto_sample": crypto_names}
    
#.. usd
@app.get("/economic/debug-raw")
async def debug_raw_calendar(current_user=Depends(get_current_user)):
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                    "Accept": "application/json, text/plain, */*",
                },
                timeout=15.0
            )

        raw_preview = res.text[:500]

        try:
            data = res.json()
        except Exception as parse_err:
            return {
                "status_code": res.status_code,
                "parse_error": str(parse_err),
                "raw_preview": raw_preview
            }

        if not isinstance(data, list):
            return {
                "status_code": res.status_code,
                "unexpected_shape": str(type(data)),
                "raw_preview": raw_preview
            }

        gbp_cpi = [e for e in data if e.get("country") == "GBP" and "CPI" in e.get("title", "")]

        return {
            "status_code": res.status_code,
            "total_events": len(data),
            "gbp_cpi_matches": gbp_cpi,
            "sample_first_event": data[0] if data else None
        }

    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)}"}

#..gbp
@app.get("/economic/debug-ons-v4")
async def debug_ons_v4(current_user=Depends(get_current_user)):
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                "https://api.beta.ons.gov.uk/v1/datasets/cpih01/editions/time-series/versions/67/observations",
                params={
                    "time": "*",
                    "geography": "K02000001",   # UK
                    "aggregate": "cpih1dim1A0",  # CPIH All Items index
                },
                timeout=15.0
            )
        return {"status_code": res.status_code, "body_preview": res.text[:2000]}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)}"}

#.. cad
@app.get("/economic/debug-statcan-v2")
async def debug_statcan_v2(current_user=Depends(get_current_user)):
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Try a simple GET to their base domain first — just checking reachability
            res = await client.get("https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata", timeout=25.0)
        return {"status_code": res.status_code, "body_preview": res.text[:500]}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)}"}
