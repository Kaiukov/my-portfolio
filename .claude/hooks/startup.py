#!/usr/bin/env python3
import subprocess
import os
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
init_script = project_root / ".claude" / "hooks" / "init.py"
news_dir = project_root / "news"
tmp_dir = project_root / "tmp"
market_data_file = tmp_dir / "market_data.json"
recent_news_file = tmp_dir / "recent_news.md"

tmp_dir.mkdir(exist_ok=True)

# Pull latest changes from git (only if working directory is clean)
result = subprocess.run(
    ["git", "status", "--porcelain", "--untracked-files=no"],
    capture_output=True,
    text=True,
    cwd=project_root
)

if result.stdout.strip():
    print("Skipping git pull - you have unstaged changes")
else:
    print("Pulling latest changes...")
    subprocess.run(["git", "pull"], cwd=project_root)

# Run init.py and save market data
market_saved = False
if init_script.exists():
    result = subprocess.run(
        ["uv", "run", str(init_script)],
        capture_output=True,
        text=True,
        cwd=project_root
    )
    if result.stdout:
        market_data_file.write_text(result.stdout)
        market_saved = True
    elif result.stderr:
        print(f"Error fetching market data: {result.stderr.strip()}")

# Collect and save recent news
news_content = []
if news_dir.exists():
    for f in sorted(news_dir.rglob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file():
            news_content.append(f.read_text())
            news_content.append("---\n")

news_saved = False
if news_content:
    recent_news_file.write_text("".join(news_content))
    news_saved = True

if market_saved:
    print(f"Market data saved to {market_data_file}")
if news_saved:
    print(f"Recent news saved to {recent_news_file}")

