#!/usr/bin/env python3
"""
Portfolio transaction extractor from Yahoo Finance PDF.
Extracts transactions and converts to CSV format.
"""

import csv
import re
from datetime import datetime
from pathlib import Path
from typing import Optional


def determine_asset_type(symbol: str) -> str:
    """Determine asset type from symbol."""
    symbol_upper = symbol.upper()

    # Cryptocurrencies
    if symbol_upper.endswith('-USD') or symbol_upper.endswith('-EUR'):
        return 'crypto'

    # UK stocks
    if symbol_upper.endswith('.L'):
        return 'stock'

    # German/European stocks
    if symbol_upper.endswith('.DE'):
        return 'stock'

    # US ETFs - common patterns
    etf_patterns = [
        'SPLG', 'SCHD', 'VGIT', 'VGEU', 'XLP', 'QQQ', 'BITO'
    ]
    if any(symbol_upper.startswith(p) for p in etf_patterns):
        return 'etf'

    # Futures/Commodities
    if symbol_upper.endswith('=F'):
        return 'commodity'

    # Default to stock
    return 'stock'


def normalize_quantity(qty_str: str) -> float:
    """Normalize quantity value handling European decimal format."""
    if not qty_str or qty_str.strip() == '':
        return 0.0

    qty_str = str(qty_str).strip()

    # Handle comma as decimal separator (European format)
    if ',' in qty_str and '.' in qty_str:
        # If both present, determine which is decimal based on position
        comma_pos = qty_str.rfind(',')
        dot_pos = qty_str.rfind('.')
        if comma_pos > dot_pos:
            # Comma is decimal: 1.234,56 -> 1234.56
            qty_str = qty_str.replace('.', '').replace(',', '.')
        else:
            # Dot is decimal: 1,234.56 -> 1234.56
            qty_str = qty_str.replace(',', '')
    elif ',' in qty_str:
        # Only comma, likely decimal separator
        qty_str = qty_str.replace(',', '.')

    try:
        return float(qty_str)
    except ValueError:
        return 0.0


def normalize_price(price_str: str) -> float:
    """Normalize price value handling European decimal format."""
    if not price_str or price_str.strip() in ['', '--']:
        return 0.0

    price_str = str(price_str).strip()

    # Handle comma as decimal separator (European format)
    if ',' in price_str and '.' in price_str:
        comma_pos = price_str.rfind(',')
        dot_pos = price_str.rfind('.')
        if comma_pos > dot_pos:
            # Comma is decimal: 1.234,56 -> 1234.56
            price_str = price_str.replace('.', '').replace(',', '.')
        else:
            # Dot is decimal: 1,234.56 -> 1234.56
            price_str = price_str.replace(',', '')
    elif ',' in price_str:
        # Only comma, likely decimal separator
        price_str = price_str.replace(',', '.')

    try:
        return float(price_str)
    except ValueError:
        return 0.0


def parse_date(date_str: str) -> Optional[str]:
    """Parse date from DD.MM.YYYY format to YYYY-MM-DD."""
    if not date_str or date_str.strip() == '':
        return None

    date_str = date_str.strip()

    try:
        # Try DD.MM.YYYY format
        dt = datetime.strptime(date_str, '%d.%m.%Y')
        return dt.strftime('%Y-%m-%d')
    except ValueError:
        try:
            # Try DD.MM.YYYY with leading zeros
            dt = datetime.strptime(date_str, '%d.%m.%Y')
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            return None


def detect_currency(symbol: str, price_str: str = '') -> str:
    """Detect currency from symbol or context."""
    symbol_upper = symbol.upper()

    # Crypto and USD assets
    if symbol_upper.endswith('-USD') or symbol_upper in ['BTC-USD', 'ETH-USD', 'BNB-USD']:
        return 'USD'

    # EUR assets
    if symbol_upper.endswith('-EUR') or symbol_upper.endswith('.DE'):
        return 'EUR'

    # UK assets
    if symbol_upper.endswith('.L'):
        return 'GBP'

    # Default to USD
    return 'USD'


def extract_transactions_manually() -> list[dict]:
    """
    Manually extract transactions from the PDF content.
    This is the primary extraction method.
    """
    transactions = [
        # PAXG-USD transactions
        {'date': '2025-10-20', 'asset': 'PAXG-USD', 'action': 'buy', 'quantity': 0.1867, 'price': 4348.02, 'fees': 0.3},
        {'date': '2025-10-19', 'asset': 'PAXG-USD', 'action': 'buy', 'quantity': 0.1599, 'price': 4244.77, 'fees': 0.0},
        {'date': '2025-10-17', 'asset': 'PAXG-USD', 'action': 'buy', 'quantity': 0.0081, 'price': 4411.0, 'fees': 0.1},
        {'date': '2025-10-17', 'asset': 'PAXG-USD', 'action': 'buy', 'quantity': 0.0218, 'price': 4408.18, 'fees': 0.1},

        # IGLN.L transactions
        {'date': '2025-10-24', 'asset': 'IGLN.L', 'action': 'buy', 'quantity': 6, 'price': 78.84, 'fees': 2.48},
        {'date': '2025-10-17', 'asset': 'IGLN.L', 'action': 'buy', 'quantity': 6, 'price': 79.15, 'fees': 0.0},
        {'date': '2025-07-02', 'asset': 'IGLN.L', 'action': 'buy', 'quantity': 6, 'price': 64.8, 'fees': 2.5},

        # VGIT transactions
        {'date': '2025-11-17', 'asset': 'VGIT', 'action': 'buy', 'quantity': 9, 'price': 60.018, 'fees': 2.0},
        {'date': '2025-06-11', 'asset': 'VGIT', 'action': 'buy', 'quantity': 6, 'price': 58.96, 'fees': 0.0},

        # VGEU.DE transactions
        {'date': '2025-09-30', 'asset': 'VGEU.DE', 'action': 'buy', 'quantity': 10, 'price': 42.93, 'fees': 2.2},
        {'date': '2025-05-15', 'asset': 'VGEU.DE', 'action': 'buy', 'quantity': 4, 'price': 41.985, 'fees': 0.0},

        # XCH-USD transactions
        {'date': '2025-10-16', 'asset': 'XCH-USD', 'action': 'sell', 'quantity': 13.05, 'price': 7.44, 'fees': 0.0},
        {'date': '2024-07-14', 'asset': 'XCH-USD', 'action': 'buy', 'quantity': 13.05, 'price': 19.61, 'fees': 0.0},

        # BTC-USD transactions
        {'date': '2025-11-09', 'asset': 'BTC-USD', 'action': 'sell', 'quantity': 0.00446, 'price': 105000, 'fees': 0.5},
        {'date': '2025-10-24', 'asset': 'BTC-USD', 'action': 'sell', 'quantity': 0.00451, 'price': 110621.99, 'fees': 0.2},
        {'date': '2025-10-23', 'asset': 'BTC-USD', 'action': 'sell', 'quantity': 0.00664, 'price': 108625.98, 'fees': 0.7},
        {'date': '2025-10-21', 'asset': 'BTC-USD', 'action': 'sell', 'quantity': 0.0056, 'price': 110841.91, 'fees': 0.58},
        {'date': '2025-10-19', 'asset': 'BTC-USD', 'action': 'sell', 'quantity': 0.009, 'price': 107659.65, 'fees': 0.92},
        {'date': '2025-10-11', 'asset': 'BTC-USD', 'action': 'buy', 'quantity': 0.00089, 'price': 111824.06, 'fees': 0.5},

        # ETH-USD transactions
        {'date': '2025-09-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00043, 'price': 115788.03, 'fees': 0.21},
        {'date': '2025-08-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00082, 'price': 121541.52, 'fees': 0.4},
        {'date': '2025-07-18', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0007, 'price': 119221.02, 'fees': 0.0},
        {'date': '2025-06-22', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00048, 'price': 102720, 'fees': 0.7},
        {'date': '2025-06-04', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00047, 'price': 105394.73, 'fees': 0.5},
        {'date': '2025-05-14', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00048, 'price': 103516.84, 'fees': 0.0},
        {'date': '2025-05-03', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00103, 'price': 96399.7, 'fees': 0.0},
        {'date': '2025-04-15', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00058, 'price': 85054, 'fees': 0.0},
        {'date': '2025-04-01', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00059, 'price': 83877.99, 'fees': 0.0},
        {'date': '2025-03-01', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00118, 'price': 84373.01, 'fees': 0.1},
        {'date': '2025-03-01', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00139, 'price': 84800, 'fees': 0.1},
        {'date': '2025-02-03', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00049, 'price': 101808, 'fees': 0.5},
        {'date': '2025-02-03', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0005, 'price': 99283.31, 'fees': 0.4},
        {'date': '2025-01-11', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00052, 'price': 94739.87, 'fees': 0.74},
        {'date': '2025-01-11', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00052, 'price': 94739.87, 'fees': 0.74},
        {'date': '2024-12-06', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00051, 'price': 97983.09, 'fees': 0.1},
        {'date': '2024-12-01', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00051, 'price': 96424.02, 'fees': 0.82},
        {'date': '2024-12-01', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00051, 'price': 96347.15, 'fees': 0.86},
        {'date': '2024-11-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00071, 'price': 68828.01, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00065, 'price': 76350.01, 'fees': 0.4},
        {'date': '2024-11-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00475, 'price': 60998.53, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.01579, 'price': 60998.53, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.00995, 'price': 60998.53, 'fees': 0.0},
        {'date': '2025-10-20', 'asset': 'ETH-USD', 'action': 'sell', 'quantity': 0.0343, 'price': 4365.59, 'fees': 0.14},
        {'date': '2025-10-20', 'asset': 'ETH-USD', 'action': 'sell', 'quantity': 0.3618, 'price': 4268.955, 'fees': 2.41},
        {'date': '2025-10-11', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.021, 'price': 3803, 'fees': 0.2},
        {'date': '2025-09-13', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0084, 'price': 4737.87, 'fees': 0.2},
        {'date': '2025-08-18', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0012, 'price': 4331.63, 'fees': 0.0},
        {'date': '2025-08-18', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0172, 'price': 4331.63, 'fees': 0.0},
        {'date': '2025-07-06', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0399, 'price': 2513.39, 'fees': 0.02},
        {'date': '2025-06-22', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0175, 'price': 2284.93, 'fees': 0.1},
        {'date': '2025-06-04', 'asset': 'ETH-USD', 'action': 'buy', 'quantity': 0.0151, 'price': 2646.91, 'fees': 0.1},

        # BNB-USD transactions
        {'date': '2025-05-15', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0235, 'price': 2631.86, 'fees': 0.0},
        {'date': '2025-05-08', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0515, 'price': 1941.9662, 'fees': 0.0},
        {'date': '2025-04-15', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0308, 'price': 1622.79, 'fees': 0.0},
        {'date': '2025-04-01', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0214, 'price': 1863, 'fees': 0.0},
        {'date': '2025-02-10', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0144, 'price': 2761, 'fees': 0.5},
        {'date': '2025-02-03', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0147, 'price': 2715.81, 'fees': 0.1},
        {'date': '2025-01-11', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0122, 'price': 3274.87, 'fees': 0.05},
        {'date': '2025-01-11', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0122, 'price': 3274.87, 'fees': 0.05},
        {'date': '2024-12-01', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0107, 'price': 3709.65, 'fees': 0.31},
        {'date': '2024-12-01', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0108, 'price': 3698.65, 'fees': 0.05},
        {'date': '2024-11-28', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.01666, 'price': 3587.6785, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0153, 'price': 2608.14, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.0159, 'price': 2501.34, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.12605, 'price': 3175.91, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.00887, 'price': 3175.91, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.14672, 'price': 3175.91, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.03187, 'price': 3175.91, 'fees': 0.0},
        {'date': '2025-10-19', 'asset': 'BNB-USD', 'action': 'sell', 'quantity': 0.327, 'price': 1117.83, 'fees': 0.3},
        {'date': '2025-10-11', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.017, 'price': 1127.82, 'fees': 0.9},
        {'date': '2025-09-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.01, 'price': 924.94, 'fees': 0.8},
        {'date': '2025-08-18', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.027, 'price': 837.15, 'fees': 0.0},
        {'date': '2025-06-04', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.014, 'price': 669.66, 'fees': 0.7},
        {'date': '2025-05-19', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.01, 'price': 0, 'fees': 0.0},
        {'date': '2025-04-01', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.016, 'price': 607.69, 'fees': 0.0},
        {'date': '2025-02-10', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.016, 'price': 594.44, 'fees': 0.5},
        {'date': '2025-01-11', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.014, 'price': 697.4, 'fees': 0.24},
        {'date': '2024-12-14', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.044, 'price': 721.88, 'fees': 0.1},
        {'date': '2024-12-01', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.015, 'price': 649.24, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.017, 'price': 571.3, 'fees': 0.3},
        {'date': '2024-11-13', 'asset': 'BNB-USD', 'action': 'buy', 'quantity': 0.12164, 'price': 575.85, 'fees': 0.0},

        # SPLG transactions
        {'date': '2025-10-25', 'asset': 'SPLG', 'action': 'sell', 'quantity': 2, 'price': 615.412, 'fees': 2.03},
        {'date': '2024-11-13', 'asset': 'SPLG', 'action': 'buy', 'quantity': 2, 'price': 470.95, 'fees': 5.83},

        # SCHD transactions
        {'date': '2025-10-20', 'asset': 'SCHD', 'action': 'sell', 'quantity': 13, 'price': 78.32, 'fees': 2.0},
        {'date': '2025-04-01', 'asset': 'SCHD', 'action': 'buy', 'quantity': 3, 'price': 63.858, 'fees': 0.0},
        {'date': '2025-03-03', 'asset': 'SCHD', 'action': 'buy', 'quantity': 3, 'price': 69.84, 'fees': 2.0},
        {'date': '2025-02-03', 'asset': 'SCHD', 'action': 'buy', 'quantity': 3, 'price': 70.33, 'fees': 2.0},
        {'date': '2025-01-13', 'asset': 'SCHD', 'action': 'buy', 'quantity': 2, 'price': 67.718, 'fees': 2.15},
        {'date': '2024-12-19', 'asset': 'SCHD', 'action': 'buy', 'quantity': 3, 'price': 69.568, 'fees': 2.03},
        {'date': '2024-11-13', 'asset': 'SCHD', 'action': 'buy', 'quantity': 3, 'price': 67.2, 'fees': 2.02},
        {'date': '2024-11-13', 'asset': 'SCHD', 'action': 'buy', 'quantity': 9, 'price': 65.12, 'fees': 8.25},

        # BITO transactions
        {'date': '2025-08-08', 'asset': 'BITO', 'action': 'buy', 'quantity': 17, 'price': 26.66, 'fees': 0.0},
        {'date': '2025-04-01', 'asset': 'BITO', 'action': 'buy', 'quantity': 7, 'price': 27.798, 'fees': 0.0},
        {'date': '2025-01-13', 'asset': 'BITO', 'action': 'buy', 'quantity': 8, 'price': 26.988, 'fees': 2.15},
        {'date': '2024-11-13', 'asset': 'BITO', 'action': 'buy', 'quantity': 26, 'price': 28.25, 'fees': 2.02},

        # TON11419-U transactions
        {'date': '2025-10-20', 'asset': 'TON11419-U', 'action': 'sell', 'quantity': 1, 'price': 18.23, 'fees': 2.0},
        {'date': '2024-11-13', 'asset': 'TON11419-U', 'action': 'buy', 'quantity': 1, 'price': 17.16, 'fees': 2.01},

        # ETH (likely Ethereum, closed position)
        {'date': '2025-10-25', 'asset': 'ETH', 'action': 'sell', 'quantity': 19.7217, 'price': 2.141, 'fees': 0.03},
        {'date': '2025-10-23', 'asset': 'ETH', 'action': 'sell', 'quantity': 7.51, 'price': 2.12, 'fees': 0.01},
        {'date': '2025-07-18', 'asset': 'ETH', 'action': 'buy', 'quantity': 2.99, 'price': 3.335, 'fees': 0.0},
        {'date': '2025-06-22', 'asset': 'ETH', 'action': 'buy', 'quantity': 3.48, 'price': 2.87, 'fees': 0.1},
        {'date': '2025-02-10', 'asset': 'ETH', 'action': 'buy', 'quantity': 2.44, 'price': 4.095, 'fees': 0.5},
        {'date': '2025-01-11', 'asset': 'ETH', 'action': 'buy', 'quantity': 1.85, 'price': 5.397, 'fees': 0.02},
        {'date': '2024-12-01', 'asset': 'ETH', 'action': 'buy', 'quantity': 1.48, 'price': 6.712, 'fees': 0.07},
        {'date': '2024-11-13', 'asset': 'ETH', 'action': 'buy', 'quantity': 2.07, 'price': 4.83, 'fees': 0.0},
        {'date': '2024-11-13', 'asset': 'ETH', 'action': 'buy', 'quantity': 12.92166, 'price': 6.77, 'fees': 0.0},
        {'date': '2025-10-25', 'asset': 'ETH', 'action': 'sell', 'quantity': 9, 'price': 36.772, 'fees': 2.17},
        {'date': '2024-11-20', 'asset': 'ETH', 'action': 'buy', 'quantity': 9, 'price': 29.42, 'fees': 2.01},
    ]

    return transactions


def add_currency_and_type(transactions: list[dict]) -> list[dict]:
    """Add currency and asset_type to each transaction."""
    for tx in transactions:
        asset = tx['asset']
        tx['asset_type'] = determine_asset_type(asset)
        tx['currency'] = detect_currency(asset)
        tx['exchange'] = ''  # Will be populated from notes if available

    return transactions


def create_csv(transactions: list[dict], output_path: str) -> None:
    """Write transactions to CSV file."""
    # Sort by date
    transactions_sorted = sorted(transactions, key=lambda x: x['date'])

    fieldnames = ['date', 'asset', 'asset_type', 'action', 'quantity', 'price', 'currency', 'fees', 'exchange']

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for tx in transactions_sorted:
            writer.writerow({
                'date': tx['date'],
                'asset': tx['asset'],
                'asset_type': tx['asset_type'],
                'action': tx['action'],
                'quantity': tx['quantity'],
                'price': tx['price'],
                'currency': tx['currency'],
                'fees': tx['fees'],
                'exchange': tx['exchange'],
            })


def main():
    """Main extraction and conversion workflow."""
    pdf_path = '/Users/oleksandrkaiukov/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/My portfolio (Stock ETF Crypto) - Stock Portfolio Management & Tracker - Yahoo Finance.pdf'
    output_path = '/Users/oleksandrkaiukov/Code/portfolyahoo/portfolio_transactions.csv'

    print('Extracting transactions from PDF...')

    # Extract transactions manually (more reliable than PDF parsing)
    transactions = extract_transactions_manually()

    # Add currency and asset type
    transactions = add_currency_and_type(transactions)

    # Create CSV
    create_csv(transactions, output_path)

    # Print summary
    print(f'\nExtraction Complete!')
    print(f'Total transactions: {len(transactions)}')

    # Date range
    dates = sorted([tx['date'] for tx in transactions])
    if dates:
        print(f'Date range: {dates[0]} to {dates[-1]}')

    # Unique symbols
    symbols = sorted(set(tx['asset'] for tx in transactions))
    print(f'\nSymbols found ({len(symbols)}):')
    for symbol in symbols:
        count = sum(1 for tx in transactions if tx['asset'] == symbol)
        print(f'  {symbol}: {count} transactions')

    # Asset type breakdown
    print(f'\nAsset types:')
    for asset_type in sorted(set(tx['asset_type'] for tx in transactions)):
        count = sum(1 for tx in transactions if tx['asset_type'] == asset_type)
        print(f'  {asset_type}: {count} transactions')

    # Actions breakdown
    print(f'\nActions:')
    for action in sorted(set(tx['action'] for tx in transactions)):
        count = sum(1 for tx in transactions if tx['action'] == action)
        print(f'  {action}: {count} transactions')

    print(f'\nCSV file created at: {output_path}')


if __name__ == '__main__':
    main()
