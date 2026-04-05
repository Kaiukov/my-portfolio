#!/usr/bin/env python3
"""
Get video stream URL from HDRezka.

Usage:
    python scripts/get_stream.py <url> [quality] [season] [episode]

Args:
    url: HDRezka URL (full)
    quality: Video quality (default: 720p)
    season: Season number (default: None for movies)
    episode: Episode number (default: None for movies)

Example for movie:
    python scripts/get_stream.py https://hdrezka-home.tv/cartoons/adventures/84306-goat-2026.html

Example for series:
    python scripts/get_stream.py https://hdrezka-home.tv/series/xxx.html 1080p 2 10
"""

import sys
from HdRezkaApi import HdRezkaApi


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/get_stream.py <url> [quality] [season] [episode]")
        sys.exit(1)

    url = sys.argv[1]
    quality = sys.argv[2] if len(sys.argv) > 2 else '720p'
    season = sys.argv[3] if len(sys.argv) > 3 else None
    episode = sys.argv[4] if len(sys.argv) > 4 else None

    try:
        rezka = HdRezkaApi(url)

        # Get stream
        if season and episode:
            stream = rezka.getStream(season, episode)
        else:
            stream = rezka.getStream()

        # Get video URL
        video_url = stream(quality)

        # Check for subtitles
        subtitles = stream.subtitles() if stream.subtitles() else None

        # Output JSON for easy parsing
        import json
        output = {
            "video_url": video_url,
            "quality": quality,
            "subtitles": subtitles
        }
        print(json.dumps(output, indent=2))

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
