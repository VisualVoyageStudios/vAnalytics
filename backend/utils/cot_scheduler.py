from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import date, timedelta
from database import SessionLocal
from models.cot import COTPosition
from utils.cftc_fetcher import fetch_latest_cot

import logging

logger = logging.getLogger("cot_scheduler")


def refresh_cot_data():
    """
    Pulls the latest CFTC weekly report and upserts it into cot_positions.
    Runs on a schedule — never triggered by a user request.
    """
    db = SessionLocal()
    try:
        logger.info("COT scheduler: starting weekly fetch")
        rows = fetch_latest_cot()

        if not rows:
            logger.warning("COT scheduler: fetch returned no rows, skipping")
            return

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

        # prune anything older than 52 weeks
        cutoff = date.today() - timedelta(weeks=52)
        deleted = db.query(COTPosition).filter(COTPosition.report_date < cutoff).delete()
        db.commit()

        logger.info(f"COT scheduler: inserted {inserted} new rows, pruned {deleted} old rows")

    except Exception as e:
        logger.error(f"COT scheduler: fetch failed — {e}")
        db.rollback()

    finally:
        db.close()


def start_cot_scheduler():
    scheduler = BackgroundScheduler(timezone="America/New_York")

    # CFTC publishes Friday 3:30pm ET — run at 5:00pm ET to be safe,
    # with a retry pass Saturday morning in case of a late release/holiday.
    scheduler.add_job(
        refresh_cot_data,
        trigger=CronTrigger(day_of_week="fri", hour=17, minute=0),
        id="cot_weekly_fetch",
        replace_existing=True
    )
    scheduler.add_job(
        refresh_cot_data,
        trigger=CronTrigger(day_of_week="sat", hour=9, minute=0),
        id="cot_weekly_retry",
        replace_existing=True
    )

    scheduler.start()
    logger.info("COT scheduler started — Fridays 5PM ET, Saturday 9AM ET retry")
    return scheduler
