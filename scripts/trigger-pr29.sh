#!/bin/bash
# Trigger PR #29 work at 14:01 today via cmux surface:1 (Claude Code)
TARGET=$(date -j -f "%H:%M" "14:01" +%s)
NOW=$(date +%s)
SLEEP=$((TARGET - NOW))

echo "[$(date)] Sleeping ${SLEEP}s until 14:01..."
sleep $SLEEP

echo "[$(date)] Sending 'continue' to surface:1 (Claude Code)..."
cmux send --surface surface:1 "continue"
cmux send-key --surface surface:1 "Enter"

echo "[$(date)] Done. Check surface:1 (Claude Code)."
