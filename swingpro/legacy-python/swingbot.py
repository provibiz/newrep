"""SwingBot: regelbasierter Long-Scanner, Python 3.10+."""
import argparse
import csv
import json
import math
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_FLOOR
from statistics import mean
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from experts import extra_patterns

UTC = timezone.utc
NY = ZoneInfo("America/New_York")
HOUR = timedelta(hours=1)


@dataclass(frozen=True)
class Bar:
    end: datetime
    high: float
    low: float
    close: float
    volume: float

    opening: float | None = None
    prior_close: float | None = None
    prior_day: object = None

    def __post_init__(self):
        if self.end.utcoffset() is None or not all(map(math.isfinite, (self.high, self.low, self.close, self.volume))):
            raise ValueError("Ungültiger Zeitstempel oder Kurswert")
        if not 0 < self.low <= self.close <= self.high or self.volume < 0:
            raise ValueError("Inkonsistente Kurs- oder Volumendaten")


def timestamp(raw):
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.utcoffset() is None:
        raise ValueError("Zeitstempel benötigt UTC-Offset")
    return dt.astimezone(UTC)


def csv_bars(path):
    data = defaultdict(list)
    with open(path, newline="", encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            data[row["symbol"].strip().upper()].append(Bar(timestamp(row["end"]), *(
                float(row[key]) for key in ("high", "low", "close", "volume"))))
    return data


def get_json(url, params, headers):
    req = Request(url + "?" + urlencode(params), headers=headers)
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def alpaca(symbols, now, history_days=32):
    headers = {"APCA-API-KEY-ID": os.environ["APCA_API_KEY_ID"],
               "APCA-API-SECRET-KEY": os.environ["APCA_API_SECRET_KEY"]}
    start = now - timedelta(days=history_days)
    sessions = get_json("https://paper-api.alpaca.markets/v2/calendar",
                        {"start": start.date(), "end": now.date()}, headers)
    halves = {}
    last_half = {}
    previous_session = {}
    prior_day = None
    for session in sessions:
        combine = lambda field: datetime.fromisoformat(session["date"] + "T" + session[field]).replace(tzinfo=NY)
        begin, close = combine("open"), combine("close")
        day = begin.date()
        previous_session[day] = prior_day
        prior_day = day
        last_half[(close-HOUR/2).astimezone(UTC)] = day
        while begin + HOUR <= close:
            end = (begin + HOUR).astimezone(UTC)
            if end <= now - timedelta(minutes=2):
                halves[begin.astimezone(UTC)] = end
                halves[(begin + HOUR / 2).astimezone(UTC)] = end
            begin += HOUR
    params = dict(symbols=",".join(symbols), timeframe="30Min", start=start.isoformat(),
                  end=(now - timedelta(minutes=2)).isoformat(), limit=10000, feed="iex", adjustment="split")
    groups = defaultdict(dict)
    daily_close = {}
    while True:
        page = get_json("https://data.alpaca.markets/v2/stocks/bars", params, headers)
        for symbol, bars in (page["bars"] or {}).items():
            for bar in bars:
                at = timestamp(bar["t"])
                if at in last_half:
                    daily_close[symbol, last_half[at]] = bar["c"]
                if at in halves:
                    groups[symbol, halves[at]][at] = bar
        token = page.get("next_page_token")
        if not token:
            break
        params["page_token"] = token
    data = defaultdict(list)
    for (symbol, end), pair in sorted(groups.items()):
        if len(pair) == 2:
            first, second = [pair[k] for k in sorted(pair)]
            prev = previous_session[end.astimezone(NY).date()]
            data[symbol].append(Bar(end, max(first["h"], second["h"]), min(first["l"], second["l"]),
                                    second["c"], first["v"] + second["v"], first["o"],
                                    daily_close.get((symbol, prev)), prev))
    return data, max(halves.values(), default=None)


def pivots(bars):
    return [i for i in range(2, len(bars)-2)
            if bars[i].low < min(b.low for b in bars[i-2:i] + bars[i+1:i+3])]


def higher_low(bars):
    history, current = bars[:-1], bars[-1]
    points = pivots(history)
    if len(points) < 2:
        return False
    a, b = points[-2:]
    if not (b - a >= 3 and len(history)-b <= 6 and history[b].low > history[a].low):
        return False
    if history[a].low != min(bar.low for bar in history[:b]):
        return False
    trigger = max(bar.high for bar in history[b:b+3])
    return (min(bar.low for bar in bars[b+1:]) > history[b].low
            and all(bar.close <= trigger for bar in history[b+3:])
            and current.close > trigger)


def evaluate(bars, market, cfg):
    last = bars[-1]
    if not (market[-1].close > mean(b.close for b in market[-20:]) or higher_low(market[-31:])):
        return "CASH · QQQ-Marktfilter gesperrt"
    base = bars[-cfg.base_bars-1:-1]
    ceiling = max(b.high for b in base)
    narrow = ceiling / min(b.low for b in base) - 1 <= cfg.width / 100
    prior = bars[-cfg.base_bars-11:-cfg.base_bars-1]
    breakout = (narrow and base[0].close > prior[0].close and last.close > ceiling
                and last.volume >= cfg.volume * mean(b.volume for b in base))
    setups = extra_patterns(bars)
    if higher_low(bars[-31:]):
        setups.append("First Higher Low")
    if breakout:
        setups.append("Base Breakout (Stundenbasis)")
    if getattr(cfg, "earnings_event", False):
        setups.append("Episodic Pivot (Earnings-Modell)")
    if not setups:
        return "WARTEN · kein bestätigtes Setup"
    setup = ", ".join(setups)
    day = last.end.astimezone(NY).date()
    day_low = min(b.low for b in bars if b.end.astimezone(NY).date() == day)
    stop = float(Decimal(str(day_low)).quantize(Decimal("0.01"), rounding=ROUND_FLOOR) - Decimal("0.01"))
    entry = last.close
    if stop <= 0:
        return "WARTEN · kein gültiger Stopp"
    count = math.floor(min(cfg.capital * cfg.weight / 100 / entry,
                           cfg.capital * cfg.risk / 100 / (entry-stop)))
    if count < 1:
        return "WARTEN · Risikobudget reicht für keine Aktie"
    return (f"KANDIDAT · {setup} · Referenz {entry:.4f} USD · Stopp {stop:.2f} USD · "
            f"{count} Stück · Einsatz {entry*count:.2f} USD · Planverlust {(entry-stop)*count:.2f} USD")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", metavar="DATEI")
    source.add_argument("--alpaca", action="store_true")
    p.add_argument("--replay", help="Historischer Auswertungszeitpunkt mit UTC-Offset, nur CSV")
    p.add_argument("--symbols", default="NVDA,MSFT,PLTR", help="US-Aktien in USD, durch Komma getrennt")
    for name, default in [("capital", 10000), ("risk", 0.5), ("weight", 25), ("width", 3), ("volume", 1.2)]:
        p.add_argument("--"+name, default=default, type=float)
    p.add_argument("--base-bars", type=int, default=8)
    cfg = p.parse_args()
    if not all(math.isfinite(v) and v > 0 for v in (cfg.capital,cfg.risk,cfg.weight,cfg.width,cfg.volume)) or max(cfg.risk,cfg.weight)>100 or not 3<=cfg.base_bars<=50:
        p.error("Ungültige Parameter")
    now = datetime.now(UTC)
    if cfg.replay:
        if cfg.alpaca:
            p.error("Replay benötigt CSV")
        now = timestamp(cfg.replay)
    symbols = list(dict.fromkeys(s.strip().upper() for s in cfg.symbols.split(",") if s.strip()))
    if not symbols:
        p.error("Mindestens ein Symbol angeben")
    if cfg.csv:
        data, expected = csv_bars(cfg.csv), None
    else:
        data, expected = alpaca(sorted(set(symbols) | {"QQQ"}), now)
    for sym, bars in data.items():
        data[sym] = sorted((b for b in bars if b.end <= now), key=lambda b: b.end)
        if len({b.end for b in data[sym]}) != len(data[sym]):
            raise ValueError(f"{sym}: doppelte Kerzen")
    market = data.get("QQQ", [])
    print(("HISTORISCHE SIMULATION" if cfg.replay else "SCAN") + " | " + now.isoformat())
    if len(market)<31 or now-market[-1].end > HOUR*1.5 or (expected and market[-1].end != expected):
        print("PAUSE · QQQ-Daten fehlen oder sind zu alt")
        return
    print("Letzte abgeschlossene Stunde:", market[-1].end.isoformat())
    n = max(cfg.base_bars+11,31)
    for sym in symbols:
        bars = data.get(sym, [])
        if len(bars)<n or [b.end for b in bars[-n:]] != [b.end for b in market[-n:]] or any(b.volume<=0 for b in bars[-n:]):
            print(sym, "· DATENLÜCKE · zu wenige oder nicht synchronisierte Kerzen")
            continue
        print(sym, "·", evaluate(bars, market, cfg))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as exc:
        sys.exit(f"Scan abgebrochen: {exc}")
