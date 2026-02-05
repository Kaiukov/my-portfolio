---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), WebSearch, WebFetch, Read, sequentialthinking, TodoWrite
description: Research latest news and generate a report
default-mode: acceptEdits
---

# News orchestrator
All futher command must run unattended and do not wait confirmation from user to continue.

## Variables
- DATETIME = bash "date +%Y%m%d"

## Phase 1: Run simultaniosly 
- Agent: biggest-investors-news
- Agent: ukr-news

## Phase 2: Run when phase 1 is completed
- Command: .claude/commands/news.md (/news [русский] [Standart-daily-report] [/Users/oleksandrkaiukov/Code/my-portfolio/reports] [date: $DATETIME])

## Path
- tmp/ use for temporary files/