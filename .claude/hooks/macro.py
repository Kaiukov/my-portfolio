#!/usr/bin/env python3
"""
Smart DCA 3.1 - Macroeconomic Analysis Script

Analyzes 8 macro indicators to determine investment regime:
- PROTECTION (6-8 peak signals)
- CAUTION (4-5 peak signals)
- AGGRESSIVE (0-3 peak signals)
"""

import requests
import re
import json
import sys
from datetime import datetime
from bs4 import BeautifulSoup
import yfinance as yf


def fetch_cape():
    """Fetch CAPE Shiller P/E ratio from multpl.com"""
    try:
        response = requests.get('https://www.multpl.com/shiller-pe', timeout=10)
        match = re.search(r'id="current">(.*?)</div>', response.text, re.DOTALL)
        if match:
            value_match = re.search(r'(\d+\.\d+)', match.group(1))
            if value_match:
                return float(value_match.group(1))
    except Exception as e:
        print(f"[WARN] Failed to fetch CAPE: {e}", file=sys.stderr)
    return None


def fetch_sp500_ath():
    """Fetch S&P 500 distance from all-time high"""
    try:
        sp500 = yf.Ticker('^GSPC')
        hist = sp500.history(period='1y')
        current = hist['Close'].iloc[-1]
        ath = hist['Close'].max()
        pct_from_ath = ((current / ath) - 1) * 100
        return pct_from_ath, abs(pct_from_ath) <= 2
    except Exception as e:
        print(f"[WARN] Failed to fetch S&P 500 ATH: {e}", file=sys.stderr)
    return None, False


def fetch_pe_ratio():
    """Fetch S&P 500 P/E ratio from multpl.com"""
    try:
        response = requests.get('https://www.multpl.com/s-p-500-pe-ratio', timeout=10)
        match = re.search(r'id="current">(.*?)</div>', response.text, re.DOTALL)
        if match:
            value_match = re.search(r'(\d+\.\d+)', match.group(1))
            if value_match:
                return float(value_match.group(1))
    except Exception as e:
        print(f"[WARN] Failed to fetch P/E ratio: {e}", file=sys.stderr)
    return None


def fetch_unemployment():
    """Fetch US unemployment rate from FRED"""
    try:
        response = requests.get('https://fred.stlouisfed.org/series/UNRATE', timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        element = soup.select_one('.series-meta-observation-value')
        if element:
            text = element.get_text(strip=True)
            match = re.search(r'(\d+\.\d+)', text)
            if match:
                return float(match.group(1))
    except Exception as e:
        print(f"[WARN] Failed to fetch unemployment: {e}", file=sys.stderr)
    return None


def fetch_fear_greed():
    """Fetch CNN Fear & Greed index"""
    try:
        response = requests.get(
            'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
            timeout=10
        )
        data = response.json()
        return data['fear_and_greed']['data'][0]['x']
    except Exception as e:
        print(f"[WARN] Failed to fetch Fear & Greed: {e}", file=sys.stderr)
    return None


def get_regime(signals):
    """Determine regime based on peak signal count"""
    if signals >= 6:
        return {'name': 'PROTECTION', 'label_ru': 'ЗАЩИТА', 'emoji': '🔴'}
    elif signals >= 4:
        return {'name': 'CAUTION', 'label_ru': 'ОСТОРОЖНОСТЬ', 'emoji': '🟡'}
    else:
        return {'name': 'AGGRESSIVE', 'label_ru': 'АГРЕССИВНОЕ', 'emoji': '🟢'}


def main():
    print("Fetching macroeconomic indicators...", file=sys.stderr)

    # Fetch all indicators
    cape = fetch_cape()
    ath_pct, near_ath = fetch_sp500_ath()
    pe_ratio = fetch_pe_ratio()
    unemployment = fetch_unemployment()
    fear_greed = fetch_fear_greed()

    # Count peak signals
    signals = 0
    active_signals = []

    # CAPE Shiller P/E
    cape_peak = bool(cape and cape > 30)
    if cape_peak:
        signals += 1
        active_signals.append(f"CAPE: {cape:.1f} > 30")

    # S&P 500 ATH
    if near_ath:
        signals += 1
        active_signals.append(f"S&P500 ATH: {ath_pct:+.1f}%")

    # P/E Ratio
    pe_peak = bool(pe_ratio and pe_ratio > 25)
    if pe_peak:
        signals += 1
        active_signals.append(f"P/E: {pe_ratio:.1f} > 25")

    # Unemployment
    unemp_peak = bool(unemployment and unemployment < 4.5)
    if unemp_peak:
        signals += 1
        active_signals.append(f"Unemployment: {unemployment}% < 4.5%")

    # Fear & Greed
    fg_peak = bool(fear_greed and fear_greed > 75)
    if fg_peak:
        signals += 1
        active_signals.append(f"Fear & Greed: {fear_greed} > 75")

    # Missing indicators (not counted in signal total)
    missing = ['margin_debt', 'buffett_cash', 'aaii_stocks']

    # Get regime
    regime = get_regime(signals)

    # Build result
    result = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'peak_signals_count': signals,
        'available_signals': 5,
        'total_indicators': 8,
        'regime': {
            'name': regime['name'],
            'label_ru': regime['label_ru'],
            'emoji': regime['emoji']
        },
        'indicators': {
            'cape_shiller': {'value': cape, 'peak': int(cape_peak), 'threshold': 30},
            'sp500_ath': {'value': f'{ath_pct:+.1f}%' if ath_pct is not None else None, 'peak': int(near_ath), 'threshold': '±2%'},
            'pe_ratio': {'value': pe_ratio, 'peak': int(pe_peak), 'threshold': 25},
            'unemployment': {'value': unemployment, 'peak': int(unemp_peak), 'threshold': 4.5},
            'fear_greed': {'value': fear_greed, 'peak': int(fg_peak), 'threshold': 75}
        },
        'active_signals': active_signals,
        'missing_indicators': missing
    }

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
