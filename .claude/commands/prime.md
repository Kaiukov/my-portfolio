---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), WebSearch, WebFetch, Read, sequentialthinking, TodoWrite
description: Load initial data for analysis
default-mode: acceptEdits

---

# Prime

Run the command to gather latest market data, CAPE ratio, Fear and Greed Index, FX rates, crypto prices, stock prices, etc.

## Execute

- `git push && git fetch && git pull`
- Run script `echo $(pwd) && uv run $(pwd)/.claude/hooks/init.py` to gather CAPE ratio and Fear and Greed Index.

## Report

Provide a summary