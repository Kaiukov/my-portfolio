#!/usr/bin/env python3
"""
List available translators for HDRezka URL.

Usage:
    python scripts/list_translators.py <url>
"""

import sys
from HdRezkaApi import HdRezkaApi


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/list_translators.py <url>")
        sys.exit(1)

    url = sys.argv[1]

    try:
        rezka = HdRezkaApi(url)
        print(f"Available translators for:\n  {url}\n")

        # Note: translators is an int (count), not a list
        print(f"Total translators: {rezka.translators}")
        print("\nUse get_stream.py to get video URL with default translator.")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
