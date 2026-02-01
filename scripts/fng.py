#!/usr/bin/env python3
# /// script
# dependencies = [
#   "fear-and-greed",
# ]
# ///

import fear_and_greed
import sys
from datetime import datetime

def show_index():
    try:
        data = fear_and_greed.get()
        
        # Визуализация для CLI
        value = int(data.value)
        bar_length = 20
        filled = int(value / 100 * bar_length)
        bar = "█" * filled + "-" * (bar_length - filled)
        
        print(f"\n[ {bar} ] {value}/100")
        print(f"Статус:   {data.description.upper()}")
        print(f"Обновлено: {data.last_update.strftime('%Y-%m-%d %H:%M:%S')}")
        print("-" * 30)
        
    except Exception as e:
        print(f"Ошибка: Не удалось получить данные. {e}")
        sys.exit(1)

if __name__ == "__main__":
    show_index()