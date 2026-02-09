#!/bin/bash

# Load latest 24h financial news files into Claude Code context
echo "=== Loading Latest Financial News (24h) ==="

# Files modified in last 24 hours, sorted by time
find ~/my-portfolio/rss -name "*.md" -mtime -1 -exec ls -lt {} + | awk '{print $NF}' | while read file; do
    echo ""
    echo "### File: $(basename "$file")"
    head -20 "$file"  # First 20 lines to keep context manageable
    echo "..."
done

echo ""
echo "=== Context loaded successfully ==="
