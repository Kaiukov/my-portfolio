#!/usr/bin/env python3
"""
Fetch the 4 SmartDCA macro indicators and print JSON.

Usage:
    uv run --with yfinance python3 scripts/macro_indicators.py
    uv run --with yfinance python3 scripts/macro_indicators.py --json

Sources:
    CAPE         - multpl.com (SSR, no JS required)
    Fear & Greed - CNN dataviz API (Referer header required)
    UNRATE       - FRED CSV (public, no key)
    SPX vs SMA200 - yfinance ^GSPC
"""

import json
import re
import sys
import csv
import io
import urllib.request
from datetime import datetime


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def fetch_cape() -> dict:
    url = "https://www.multpl.com/shiller-pe"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
        html = r.read().decode("utf-8", errors="replace")
    m = re.search(r"Current Shiller PE Ratio[^0-9]*([0-9]+\.[0-9]+)", html)
    if not m:
        return {"value": None, "error": "parse_failed"}
    value = float(m.group(1))
    peak = value > 30
    return {"value": value, "peak": peak, "source": "multpl.com"}


def fetch_fear_greed() -> dict:
    url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    headers = {
        **HEADERS,
        "Referer": "https://edition.cnn.com/markets/fear-and-greed",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode("utf-8"))
    fg = data["fear_and_greed"]
    value = float(fg["score"])
    peak = value > 75
    return {
        "value": round(value, 2),
        "rating": fg["rating"],
        "peak": peak,
        "source": "CNN dataviz API",
    }


def fetch_unrate() -> dict:
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE"
    with urllib.request.urlopen(url, timeout=15) as r:
        text = r.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    for row in reversed(rows):
        val = row.get("UNRATE", "").strip()
        if val:
            value = float(val)
            date = row["observation_date"]
            peak = value <= 3.8
            ok_band = 3.8 <= value <= 4.8
            return {
                "value": value,
                "date": date,
                "peak": peak,
                "ok_band": ok_band,
                "source": "FRED",
            }
    return {"value": None, "error": "parse_failed"}


def fetch_spx_vs_sma200() -> dict:
    try:
        import yfinance as yf
    except ImportError:
        return {"value": None, "error": "yfinance not installed"}

    hist = yf.download("^GSPC", period="1y", interval="1d", progress=False, auto_adjust=True)
    closes = hist["Close"].dropna().squeeze().tolist()
    if len(closes) < 200:
        return {"value": None, "error": "insufficient_data"}
    price = closes[-1]
    sma200 = sum(closes[-200:]) / 200
    above = price > sma200
    peak = not above
    return {
        "spx_price": round(price, 2),
        "sma200": round(sma200, 2),
        "above_sma200": above,
        "peak": peak,
        "source": "yfinance",
    }


def main():
    results = {}
    errors = []

    for name, fn in [
        ("cape", fetch_cape),
        ("fear_greed", fetch_fear_greed),
        ("unrate", fetch_unrate),
        ("spx_sma200", fetch_spx_vs_sma200),
    ]:
        try:
            results[name] = fn()
        except Exception as e:
            results[name] = {"value": None, "error": str(e)}
            errors.append(f"{name}: {e}")

    peak_count = sum(
        1 for k in ["cape", "fear_greed", "unrate", "spx_sma200"]
        if results.get(k, {}).get("peak") is True
    )

    def _is_missing(key, data):
        if data.get("error"):
            return True
        if key == "spx_sma200":
            return data.get("spx_price") is None
        return data.get("value") is None

    missing = sum(
        _is_missing(k, results.get(k, {}))
        for k in ["cape", "fear_greed", "unrate", "spx_sma200"]
    )

    if missing > 1:
        regime = "CAUTION"
        regime_reason = f"{missing} indicators missing"
    elif peak_count <= 1:
        regime = "AGGRESSIVE"
        regime_reason = f"{peak_count} PEAK"
    elif peak_count == 2:
        regime = "CAUTION"
        regime_reason = "2 PEAK"
    else:
        regime = "PROTECTION"
        regime_reason = f"{peak_count} PEAK"

    output = {
        "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "regime": regime,
        "regime_reason": regime_reason,
        "peak_count": peak_count,
        "missing_count": missing,
        "indicators": results,
        "errors": errors,
    }

    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
