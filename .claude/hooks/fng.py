#!/usr/bin/env python3
# /// script
# dependencies = [
#   "fear-and-greed",
# ]
# ///

import fear_and_greed
import sys
import json
from datetime import datetime

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

if __name__ == "__main__":
    result = get_index()
    print(json.dumps(result, ensure_ascii=False))