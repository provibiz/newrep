"""Öffentliche Ansätze und explizite Modellregeln, siehe REGELN.md."""
import csv
import io
import json
import math
import os
from datetime import date, timedelta
from functools import lru_cache
from statistics import mean
from urllib.parse import urlencode
from urllib.request import Request, urlopen

FMP = "https://financialmodelingprep.com/stable/"


def read_url(url):
    with urlopen(Request(url, headers={"User-Agent": "SwingPro/1.0"}), timeout=8) as response:
        return response.read().decode("utf-8-sig")


def fmp(endpoint, symbol, **kwargs):
    params = dict(symbol=symbol, apikey=os.environ["FMP_API_KEY"], **kwargs)
    rows = json.loads(read_url(FMP + endpoint + "?" + urlencode(params)))
    if not isinstance(rows, list):
        raise ValueError("Unerwartetes Datenformat")
    return rows


def index_status(text, today):
    values = {}
    for row in csv.DictReader(io.StringIO(text)):
        day = date.fromisoformat(row["observation_date"])
        raw = row["SP500"]
        if day < today and raw not in ("", "."):
            value = float(raw)
            if math.isfinite(value) and value > 0:
                values[day] = value
    days = sorted(values)
    if len(days) < 200 or (today-days[-1]).days > 5:
        raise ValueError("Indexdaten unvollständig")
    close = values[days[-1]]
    sma = mean(values[d] for d in days[-200:])
    state = "über" if close > sma else "unter" if close < sma else "auf"
    return f"Baron · S&P 500 {state} SMA200 · {close:.2f} / {sma:.2f} · Stand {days[-1]}"


@lru_cache(maxsize=3)
def baron(today):
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?" + urlencode(
        {"id":"SP500", "cosd":today-timedelta(days=380), "coed":today-timedelta(days=1)})
    return index_status(read_url(url), today)


def growth_score(rows, today):
    # Same-day filings are deferred to the next day to avoid inferring an announcement time.
    rows = [r for r in rows if r.get("period") in ("Q1","Q2","Q3","Q4")
            and r.get("filingDate") and date.fromisoformat(r["filingDate"]) < today]
    latest = max(rows, key=lambda r:r["date"])
    if not 0 < (today-date.fromisoformat(latest["date"])).days <= 180:
        raise ValueError("Quartalsdaten veraltet")
    prev = next(r for r in rows if r["period"] == latest["period"]
                and int(r["fiscalYear"]) == int(latest["fiscalYear"])-1)
    if not latest.get("reportedCurrency") or latest["reportedCurrency"] != prev.get("reportedCurrency"):
        raise ValueError("Währungen uneinheitlich")
    def change(key):
        old, new = float(prev[key]), float(latest[key])
        if not all(map(math.isfinite,(old,new))) or old <= 0:
            raise ValueError("Ungeeignete Vergleichsbasis")
        return (new/old - 1)*100
    sales, earnings = change("revenue"), change("epsDiluted")
    label = "Wachstumskandidat" if sales >= 20-1e-8 and earnings >= 25-1e-8 else "Schwellen verfehlt"
    return (f"Giering-Modell · {label} · Umsatz {sales:+.1f} %, verwässertes EPS {earnings:+.1f} % "
            f"ggü. Vorjahresquartal · {latest['period']} {latest['fiscalYear']}")


@lru_cache(maxsize=2048)
def growth(symbol, today):
    return growth_score(fmp("income-statement", symbol, period="quarter", limit=8), today)


@lru_cache(maxsize=1024)
def recent_earnings(symbol, prior_day, today):
    rows = fmp("earnings", symbol, limit=8)
    return any(r.get("date") in (prior_day.isoformat(), today.isoformat())
               and r.get("epsActual") is not None for r in rows)


def ema(closes, period):
    value = mean(closes[:period])
    for c in closes[period:]:
        value += 2/(period+1)*(c-value)
    return value


def extra_patterns(bars):
    last, previous = bars[-1], bars[-2]
    prior = bars[-12:-1]
    names = []
    old_low = min(b.low for b in prior)
    if last.low < old_low < last.close and last.close > previous.close:
        names.append("Undercut & Rally")
    left, right = bars[-9:-5], bars[-5:-1]
    def bounds(group):
        return max(b.high for b in group), min(b.low for b in group)
    h1,l1 = bounds(left)
    h2,l2 = bounds(right)
    if h2<h1 and l2<l1 and h2-l2<h1-l1 and last.close>h2 and last.volume>mean(b.volume for b in right):
        names.append("Wedge Pop")
    closes = [b.close for b in bars[-31:]]
    avg = ema(closes[:-1],20)
    if avg>ema(closes[:-2],20) and previous.close>avg and last.low<=avg and last.close>previous.high:
        names.append("EMA-Crossback")
    shelf = bars[-5:-1]
    hi,lo = bounds(shelf)
    if bars[-5].close>=1.03*bars[-10].close and hi/lo<=1.025 and last.close>hi:
        names.append("Base’n Break")
    return names
