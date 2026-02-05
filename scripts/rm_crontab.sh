#!/bin/bash
# Remove crontab task for agent.py

# Check if cron entry exists
if ! crontab -l 2>/dev/null | grep -q "scripts/agent.py"; then
    echo "⚠️  No crontab entry found for scripts/agent.py"
    exit 0
fi

# Remove all lines containing "scripts/agent.py"
crontab -l 2>/dev/null | grep -v "scripts/agent.py" | crontab -

echo "✅ Crontab entry removed"
