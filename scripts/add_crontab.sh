#!/bin/bash
# Add crontab task to run agent.py daily at 04:00 AM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Crontab entry: run at 04:00 AM daily
CRON_ENTRY="0 4 * * * cd $PROJECT_ROOT && uv run scripts/agent.py >> $PROJECT_ROOT/logs/cron.log 2>&1"

# Create logs directory if not exists
mkdir -p "$PROJECT_ROOT/logs"

# Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "scripts/agent.py"; then
    echo "⚠️  Crontab entry already exists"
    exit 0
fi

# Add new cron entry
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "✅ Crontab added: 0 4 * * * (runs daily at 04:00 AM)"
echo "📝 Logs: $PROJECT_ROOT/logs/cron.log"
