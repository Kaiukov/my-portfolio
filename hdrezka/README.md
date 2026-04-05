# HDRezka Downloader Scripts

Python project for downloading media from HDRezka to ZimaOS media server.

## Setup

Project uses `uv` for environment management.

```bash
cd /root/hdrezka
/root/.local/bin/uv add HdRezkaApi
```

## Scripts

### get_stream.py

Get video stream URL from HDRezka.

**Usage:**
```bash
/root/.local/bin/uv run python scripts/get_stream.py <url> [quality] [season] [episode]
```

**Examples:**

Movie (default 720p):
```bash
/root/.local/bin/uv run python scripts/get_stream.py "https://hdrezka-home.tv/cartoons/adventures/84306-goat-2026.html"
```

Series with season/episode:
```bash
/root/.local/bin/uv run python scripts/get_stream.py "https://hdrezka-home.tv/series/xxx.html" 1080p 2 10
```

**Output:**
```json
{
  "video_url": "https://...",
  "quality": "720p",
  "subtitles": null
}
```

### list_translators.py

List available translators for HDRezka URL.

**Usage:**
```bash
/root/.local/bin/uv run python scripts/list_translators.py <url>
```

### download_to_zima.sh

Complete download pipeline: get URL → download to ZimaOS → monitor → cleanup.

**Usage:**
```bash
./scripts/download_to_zima.sh <url> [filename] [quality] [season] [episode]
```

**Examples:**

Download movie:
```bash
./scripts/download_to_zima.sh \
  "https://hdrezka-home.tv/cartoons/adventures/84306-goat-2026.html" \
  "GOAT_2026.mp4" \
  "720p"
```

Download series episode:
```bash
./scripts/download_to_zima.sh \
  "https://hdrezka-home.tv/series/xxx.html" \
  "Series_S02E010.mp4" \
  "1080p" \
  "2" \
  "10"
```

**Environment Variables:**
- `ZIMAOS_IP` — ZimaOS IP (default: 100.127.254.31)
- `ZIMAOS_USER` — ZimaOS user (default: kaiukov)

**Output:**
- Downloads to `/media/sdb/mp2tb/media/downloads/<filename>`
- Creates log at `/tmp/wget_<filename>.log`
- Shows progress and completion status

## File Naming Standards

Use ONLY underscores, no spaces, no dots in names.

**Correct:**
- `GOAT_2026.mp4`
- `Series_S02E010.mp4`
- `Anime_S01E001_sub.mp4`

**Wrong:**
- `GOAT 2026.mp4` (spaces)
- `GOAT.2026.mp4` (dots)
- `Series.S02.E010.mp4` (dots)

## Directory Structure

```
/root/hdrezka/
├── .venv/              # Python virtual environment (auto-created by uv)
├── pyproject.toml      # Project dependencies
├── scripts/
│   ├── get_stream.py
│   ├── list_translators.py
│   └── download_to_zima.sh
├── README.md
└── src/
    └── hdrezka/
        ├── __main__.py  # `python -m hdrezka`
        ├── cli.py       # Click entrypoint and command wiring
        ├── runtime.py   # Shared CLI runtime helpers
        ├── config.py
        ├── output.py
        ├── api.py
        ├── exceptions.py
        ├── types.py
        └── utils.py
```

## Quick Start

1. Get stream URL:
```bash
/root/.local/bin/uv run python scripts/get_stream.py "https://hdrezka-home.tv/xxx.html"
```

2. Download to ZimaOS:
```bash
./scripts/download_to_zima.sh "https://hdrezka-home.tv/xxx.html" "file.mp4" "720p"
```

3. Check download:
```bash
ssh kaiukov@100.127.254.31 "ls -lh /media/sdb/mp2tb/media/downloads/"
```

## Notes

- Always use absolute `/root/.local/bin/uv` path for automation
- Don't use `source .venv/bin/activate` — prefer `uv run`
- For subprocess calls in Python, use `/root/.local/bin/uv` or explicit PATH
- Project follows OpenClaw Python Standard (see AGENTS.md)
