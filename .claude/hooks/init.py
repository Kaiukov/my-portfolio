#!/usr/bin/env python3
import requests
import re
import json
from datetime import datetime
import fear_and_greed
from bs4 import BeautifulSoup
import yfinance as yf


tickers = {
    "S&P 500": "^GSPC",
    "Russell 2000": "^RUT",
    "Nasdaq": "^IXIC",
    "Dow Jones": "^DJI",
    "Bitcoin": "BTC-USD",
    "Ethereum": "ETH-USD",
    "Gold": "GC=F",
    "Silver": "SI=F",
    "EUR/USD": "EURUSD=X",
    "GBP/USD": "GBPUSD=X",
    "USD/UAH": "USDUAH=X",
    "USD/JPY": "USDJPY=X",
    "USD/CNY": "USDCNY=X"
}

# Fetch CAPE (Shiller PE ratio)
cape_url = "https://www.multpl.com/shiller-pe"
cape_response = requests.get(cape_url)
cape_html = cape_response.text

# CSS selector #current - extract content and find CAPE value
cape_match = re.search(r'id="current">(.*?)</div>', cape_html, re.DOTALL)
if cape_match:
    current_content = cape_match.group(1)
    # Extract first float value (the CAPE ratio)
    value_match = re.search(r'(\d+\.\d+)', current_content)
    cape = float(value_match.group(1)) if value_match else None
else:
    cape = None

# Fetch unemployment rate from FRED
unemployment_rate = None
try:
    unrate_url = "https://fred.stlouisfed.org/series/UNRATE"
    unrate_response = requests.get(unrate_url)
    unrate_html = unrate_response.text
    soup = BeautifulSoup(unrate_html, 'html.parser')
    unrate_element = soup.select_one('.series-meta-observation-value')
    if unrate_element:
        unrate_text = unrate_element.get_text(strip=True)
        # Extract float value from text
        unrate_match = re.search(r'(\d+\.\d+)', unrate_text)
        unemployment_rate = float(unrate_match.group(1)) if unrate_match else None
except Exception as e:
    unemployment_rate = None

def get_index():
    try:
        data = fear_and_greed.get()
        return {
            "value": int(data.value),
            "description": data.description,
            "last_update": data.last_update.isoformat()
        }
    except Exception as e:
        return {"error": str(e)}

result = {}
for name, symbol in tickers.items():
    try:
        price = yf.Ticker(symbol).fast_info['lastPrice']
        result[name] = {"ticker": symbol, "price": round(price, 4)}
    except Exception as e:
        result[name] = {"ticker": symbol, "price": None, "error": str(e)}


print(json.dumps({
    "date": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    "cape": cape,
    "unemployment_rate": unemployment_rate,
    "fear_and_greed_index": get_index(),
    "market_data": result
}))
