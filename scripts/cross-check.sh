#!/bin/bash
# Cross-check CLI output consistency: run read-only commands and validate
# that every response is valid JSON with the expected envelope shape.
#
# Requires PORTFOLIO_DB_URL to be set.

set -euo pipefail

if [ -z "${PORTFOLIO_DB_URL:-}" ]; then
    echo "PORTFOLIO_DB_URL is not set" >&2
    exit 1
fi

echo "# Cross-Check: CLI Output Consistency"
echo "## $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

COMMANDS=(status cash summary report transactions allocation)

TOTAL=0
PASSED=0
FAILED=0
FAILURES=""

for cmd in "${COMMANDS[@]}"; do
    TOTAL=$((TOTAL + 1))
    echo "---"
    echo "### Command: \`$cmd\`"
    echo ""

    OUTPUT=$(uv run portfolio "$cmd" 2>&1) || true

    TMPFILE=$(mktemp)
    echo "$OUTPUT" > "$TMPFILE"

    # Validate JSON
    if ! python3 -c "import json; json.load(open('$TMPFILE'))" 2>/dev/null; then
        echo "Invalid JSON"
        echo '```'
        head -20 "$TMPFILE"
        echo '```'
        rm -f "$TMPFILE"
        FAILED=$((FAILED + 1))
        FAILURES="${FAILURES}  - ${cmd}: invalid JSON"$'\n'
        continue
    fi

    # Check ok: true
    OK=$(python3 -c "import json; print(json.load(open('$TMPFILE')).get('ok'))")
    if [ "$OK" != "True" ]; then
        echo "ok is not true (got: $OK)"
        rm -f "$TMPFILE"
        FAILED=$((FAILED + 1))
        FAILURES="${FAILURES}  - ${cmd}: ok=${OK}"$'\n'
        continue
    fi

    # Check command field matches
    CMD_FIELD=$(python3 -c "import json; print(json.load(open('$TMPFILE')).get('command',''))")
    if [ "$CMD_FIELD" != "$cmd" ]; then
        echo "command field mismatch (expected: $cmd, got: $CMD_FIELD)"
        rm -f "$TMPFILE"
        FAILED=$((FAILED + 1))
        FAILURES="${FAILURES}  - ${cmd}: command field '${CMD_FIELD}'"$'\n'
        continue
    fi

    # Check data and meta keys exist
    HAS_DATA=$(python3 -c "import json; print('data' in json.load(open('$TMPFILE')))")
    HAS_META=$(python3 -c "import json; print('meta' in json.load(open('$TMPFILE')))")

    if [ "$HAS_DATA" != "True" ] || [ "$HAS_META" != "True" ]; then
        echo "missing data or meta key (data=$HAS_DATA, meta=$HAS_META)"
        rm -f "$TMPFILE"
        FAILED=$((FAILED + 1))
        FAILURES="${FAILURES}  - ${cmd}: missing keys data=${HAS_DATA} meta=${HAS_META}"$'\n'
        continue
    fi

    # Check meta.count matches len(data) for list responses
    COUNT_CHECK=$(python3 -c "
import json
body = json.load(open('$TMPFILE'))
data = body.get('data')
meta = body.get('meta', {})
if isinstance(data, list):
    expected = len(data)
    actual = meta.get('count')
    if actual is not None and actual != expected:
        print(f'FAIL: count={actual} len={expected}')
    else:
        print('OK')
else:
    print('OK')
")

    if [ "$COUNT_CHECK" != "OK" ]; then
        echo "meta.count mismatch: $COUNT_CHECK"
        rm -f "$TMPFILE"
        FAILED=$((FAILED + 1))
        FAILURES="${FAILURES}  - ${cmd}: ${COUNT_CHECK}"$'\n'
        continue
    fi

    python3 -c "
import json
body = json.load(open('$TMPFILE'))
data = body['data']
if isinstance(data, list):
    print(f'  data: list({len(data)} items)')
elif isinstance(data, dict):
    print(f'  data: dict({len(data)} keys)')
else:
    print(f'  data: {type(data).__name__}')
print(f'  meta keys: {sorted(body.get(\"meta\",{}).keys())}')
"
    rm -f "$TMPFILE"

    PASSED=$((PASSED + 1))
    echo "Valid"
    echo ""
done

echo "---"
echo "## Summary"
echo ""
echo "| Result | Count |"
echo "|--------|-------|"
echo "| Total  | $TOTAL |"
echo "| Passed | $PASSED |"
echo "| Failed | $FAILED |"
echo ""

if [ "$FAILED" -gt 0 ]; then
    echo "### Failures"
    echo ""
    echo "$FAILURES"
    exit 1
fi

echo "All commands passed consistency checks."
