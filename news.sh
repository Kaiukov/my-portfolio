#!/bin/bash

# Configuration
DEFAULT_URL="https://news.yahoo.com/rss/finance"
URL="${1:-$DEFAULT_URL}"
USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"

# Export variables for Python to pick up
export FETCH_URL="$URL"
export FETCH_UA="$USER_AGENT"

# Fetch news and parse with python (standard library only)
python3 << 'EOF'
import sys
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
import email.utils
import subprocess
import json

# Config from environment
URL = os.environ.get("FETCH_URL")
USER_AGENT = os.environ.get("FETCH_UA")

# Fetch via curl to handle headers and UA
try:
    cmd = ["curl", "-s", "-L", "-A", USER_AGENT, URL]
    result = subprocess.run(cmd, capture_output=True, text=True)
    content = result.stdout
except Exception as e:
    print(json.dumps({"error": f"Error fetching RSS: {str(e)}"}))
    sys.exit(1)

if not content:
    print(json.dumps({"error": "No content received"}))
    sys.exit(1)

if "Too Many Requests" in content:
    print(json.dumps({"error": "Rate limited by provider"}))
    sys.exit(1)

try:
    root = ET.fromstring(content)
except Exception as e:
    print(json.dumps({"error": f"Error parsing XML: {str(e)}"}))
    sys.exit(1)

# Current time and 24 hours ago
now = datetime.now(timezone.utc)
yesterday = now - timedelta(hours=24)

news_items = []

# standard RSS uses <item> under <channel>
for item in root.findall(".//item"):
    title = item.findtext("title")
    link = item.findtext("link")
    pub_date_str = item.findtext("pubDate")
    
    if not pub_date_str:
        continue
        
    pub_date = None
    
    # Try RFC 822 (standard for RSS: Wed, 21 Oct 2015 07:28:00 GMT)
    try:
        pd_tuple = email.utils.parsedate_tz(pub_date_str)
        if pd_tuple:
            pub_date = datetime.fromtimestamp(email.utils.mktime_tz(pd_tuple), timezone.utc)
    except Exception:
        pass

    # Fallback for ISO format
    if not pub_date:
        try:
            pub_date = datetime.fromisoformat(pub_date_str.replace("Z", "+00:00"))
        except ValueError:
            pass

    if pub_date:
        # Ensure pub_date has timezone info
        if pub_date.tzinfo is None:
            pub_date = pub_date.replace(tzinfo=timezone.utc)
            
        if pub_date >= yesterday:
            news_items.append({
                "title": title,
                "link": link,
                "published": pub_date.isoformat(),
                "timestamp": int(pub_date.timestamp())
            })

# Sort by published date descending (newest first)
news_items.sort(key=lambda x: x["timestamp"], reverse=True)

output = {
    "feed": URL,
    "fetched_at": now.isoformat(),
    "count": len(news_items),
    "items": news_items
}

print(json.dumps(output, indent=2, ensure_ascii=False))
EOF
