"""Stündlicher S&P-500-Scanner. Startanleitung in START.md."""
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from datetime import datetime, timedelta

from statistics import median
from copy import copy
from experts import baron, growth, recent_earnings
from swingbot import NY, UTC, alpaca, evaluate

INDEX = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
BERLIN = ZoneInfo("Europe/Berlin")


def constituents():
    with urlopen(INDEX, timeout=25) as response:
        rows = csv.DictReader(io.StringIO(response.read().decode("utf-8-sig")))
        symbols = sorted({row["Symbol"].strip().upper() for row in rows})
    if not 450 <= len(symbols) <= 550 or not all(re.fullmatch(r"[A-Z]+([.-][A-Z]+)?", s) for s in symbols):
        raise ValueError("Unerwartetes Indexlistenformat")
    return symbols


def notify(message):
    if os.environ.get("ALERT_CHANNEL", "telegram") == "email":
        data = {"from": os.environ["MAIL_FROM"], "to": [os.environ["MAIL_TO"]],
                "subject": "SwingAlarm | " + message.splitlines()[0], "text": message}
        payload = json.dumps(data).encode()
        headers = {"Authorization": "Bearer " + os.environ["RESEND_API_KEY"],
                   "Content-Type": "application/json", "User-Agent": "SwingAlarm/1",
                   "Idempotency-Key": hashlib.sha256(payload).hexdigest()}
        req = Request("https://api.resend.com/emails", data=payload, headers=headers)
        with urlopen(req, timeout=20) as response:
            if not json.load(response).get("id"):
                raise RuntimeError("Versanddienst hat keine Nachrichten-ID geliefert")
        return
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    payload = urlencode({"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": message}).encode()
    req = Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload)
    with urlopen(req, timeout=20) as result:
        if not json.load(result).get("ok"):
            raise RuntimeError("Telegram hat die Nachricht abgelehnt")


def slot(now):
    local = now.astimezone(NY)
    end = local.replace(minute=30, second=0, microsecond=0)
    if local.weekday() < 5 and 10 <= local.hour <= 15 and 32 <= local.minute < 50:
        return end.astimezone(UTC)
    return None


def done(db, key):
    return db.execute("SELECT 1 FROM sent WHERE id=?", (key,)).fetchone()


def mark(db, key):
    with db:
        db.execute("INSERT OR IGNORE INTO sent VALUES (?)", (key,))


def earnings_price_candidate(bars):
    last = bars[-1]
    local = last.end.astimezone(NY)
    # Compare the first completed hour only with previous opening hours.
    if (local.hour, local.minute) != (10,30) or not last.opening or not last.prior_close or not last.prior_day:
        return False
    volumes = [b.volume for b in bars[:-1] if b.end.astimezone(NY).time() == local.time()]
    return (len(volumes) >= 5 and last.opening >= 1.08*last.prior_close
            and last.close >= last.opening and last.volume >= 2*median(volumes[-10:]))


DATA_ERRORS = (OSError, KeyError, ValueError, TypeError, StopIteration, IndexError)


def context(label, fn, *args):
    try:
        return fn(*args)
    except DATA_ERRORS:
        return label + " · Daten fehlen oder sind nicht vergleichbar"


def scan(db, end, symbols, cfg, clock=lambda: datetime.now(UTC), fetch=alpaca, send=notify):
    # Stable bucket IDs require the index membership to stay fixed through a retry.
    stamp = end.isoformat()
    report = {"geprüft": 0, "Datenlücken": 0, "Signale": 0}
    for offset in range(0, len(symbols), 35):
        if slot(clock()) != end:
            return
        batch = symbols[offset:offset+35]
        key = f"{stamp}|{','.join(batch)}"
        if done(db, key):
            continue
        data, expected = fetch(batch + ["QQQ"], clock(), history_days=16)
        if expected != end:
            # Holiday or already closed on an early-close day.
            if expected is not None and expected < end:
                mark(db, key)
                continue
            raise RuntimeError("Handelskalender unvollständig")
        market = data.get("QQQ", [])
        if len(market) < 31 or market[-1].end != end:
            raise RuntimeError("Referenzindex noch unvollständig")
        times = [b.end for b in market[-31:]]
        for symbol in batch:
            bars = data.get(symbol, [])
            if [b.end for b in bars[-31:]] != times or any(b.volume <= 0 for b in bars[-31:]):
                report["Datenlücken"] += 1
                continue
            report["geprüft"] += 1
            today = end.astimezone(NY).date()
            run_cfg = copy(cfg)
            run_cfg.earnings_event = False
            if earnings_price_candidate(bars):
                try:
                    run_cfg.earnings_event = recent_earnings(symbol, bars[-1].prior_day, today)
                except DATA_ERRORS:
                    print(symbol, "· Earnings-Bestätigung fehlt", flush=True)
            result = evaluate(bars, market, run_cfg)
            signal_key = f"{stamp}:{symbol}"
            if result.startswith("KANDIDAT") and not done(db, signal_key):
                trend = context("Baron", baron, today)
                if bars[-1].prior_day and not trend.endswith(str(bars[-1].prior_day)):
                    trend = f"Baron · letzter Indexschluss vom {bars[-1].prior_day} fehlt"
                quality = context("Giering-Modell", growth, symbol, today)
                if slot(clock()) != end:
                    return
                send(f"Einstiegssignal · {symbol}\n{end.astimezone(BERLIN):%d.%m.%Y %H:%M} Uhr Berlin · Stundenschluss · IEX\n"
                     + result.removeprefix("KANDIDAT · ").replace(" · ", "\n")
                     + "\n" + trend + "\n" + quality
                     + "\nStückzahl gilt für den Referenzkurs. Bei abweichendem Kurs Risiko neu prüfen.")
                mark(db, signal_key)
                report["Signale"] += 1
        mark(db, key)
    mark(db, stamp)
    print(stamp, report, flush=True)


def settings():
    capital = float(os.environ.get("CAPITAL_USD", "10000"))
    risk = float(os.environ.get("RISK_PERCENT", "0.5"))
    weight = float(os.environ.get("MAX_WEIGHT_PERCENT", "25"))
    if not all(math.isfinite(x) and x > 0 for x in (capital, risk, weight)) or max(risk,weight)>100:
        raise ValueError("Kapital oder Risikoparameter ungültig")
    return SimpleNamespace(capital=capital,risk=risk,weight=weight,base_bars=8,width=3,volume=1.2)


def main():
    channels = {"email": ("MAIL_FROM", "MAIL_TO", "RESEND_API_KEY"),
                "telegram": ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")}
    channel = os.environ.get("ALERT_CHANNEL", "telegram")
    if channel not in channels:
        raise SystemExit("ALERT_CHANNEL muss email oder telegram sein.")
    required = ("APCA_API_KEY_ID", "APCA_API_SECRET_KEY") + channels[channel]
    if any(not os.environ.get(k) for k in required):
        raise SystemExit("Zugangsdaten fehlen. Bitte START.md lesen.")
    cfg = settings()
    path = Path(os.getenv("STATE_DIR", "state"))
    path.mkdir(exist_ok=True)
    db = sqlite3.connect(path / "alarme.sqlite3")
    db.execute("CREATE TABLE IF NOT EXISTS sent (id TEXT PRIMARY KEY)")
    date, symbols = None, []
    print("Dienst gestartet. Warte auf abgeschlossene US-Handelsstunde.", flush=True)
    while True:
        try:
            end = slot(datetime.now(UTC))
            if end and not done(db, end.isoformat()):
                if end.date() != date:
                    symbols = constituents()
                    date = end.date()
                scan(db, end, symbols, cfg)
        except Exception as exc:
            # URLs in HTTP exceptions can contain Telegram tokens.
            status = exc.code if isinstance(exc, HTTPError) else type(exc).__name__
            print("Scan/Senden fehlgeschlagen:", status, "· erneuter Versuch im Zeitfenster", flush=True)
        time.sleep(60)


if __name__ == "__main__":
    main()
