#!/usr/bin/env python3
"""Check form and submissions. Reads token from /tmp/tally_token.txt"""
import json
import subprocess
import sys

with open("/tmp/tally_token.txt") as f:
    token = f.read().strip()

if not token:
    print('{"error": "TALLY_TOKEN not found"}')
    sys.exit(1)

form_id = sys.argv[1] if len(sys.argv) > 1 else "rjpd22"
action = sys.argv[2] if len(sys.argv) > 2 else "submissions"

# Build auth header without literal token in source
sep = "***auth = sep.join(["Authorization: Bearer ***, ***])
auth = "Authorization: Bearer *** + token

url = f"https://api.tally.so/forms/{form_id}"
if action == "form":
    url = f"https://api.tally.so/forms/{form_id}"
else:
    url = f"https://api.tally.so/forms/{form_id}/submissions"

result = subprocess.run(
    ["curl", "-s", url, "-H", auth],
    capture_output=True, text=True, timeout=30
)

resp = json.loads(result.stdout)
print(json.dumps(resp, indent=2, ensure_ascii=False)[:3000])
