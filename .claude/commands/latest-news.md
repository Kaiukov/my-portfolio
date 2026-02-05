---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), WebSearch, WebFetch, Read, sequentialthinking, TodoWrite
description: Research latest news and generate a report
default-mode: acceptEdits
---

# News orchestrator
All futher command must run unattended and do not wait confirmation from user to continue.

## Phase 1: Preparation phase 
### Variables
- DATETIME = bash "date +%Y%m%d"

### Skills
- Load SKILL: financial-report-format


## Phase 2: Run simultaniosly (IMPORTANT: ENSURE THEN AGENT RUNNING. OTHERWISE IT WILL BE USELESS)
- Sub-Agent: biggest-investors-news (use MCP mcp__searxng__web_search)
- Sub-Agent: ukr-news (use MCP mcp__searxng__web_search)

## Phase 3: Run when phase 2 is completed 
- Command: .claude/commands/news.md (/news [русский] [Standart-daily-report] [reports] [date: $DATETIME])

## Phase 4: Run when phase 3 is completed (IMPORTANT: Run Sub-agent for gereral purpose)
1. Find all english works in the report
2. Transact to `Russian` language, except names of companies and people.
3. Do not mix languages in the final report
4. Use `financial-report-format` skill vocabulary

## Phase 5:
- Run sub-agent to write tmp/reportData.json -> 
```json
"reportName": "string",
"reportPath": "string",
"reportTitle": "string"
```


## Path
- tmp/ use for temporary files/