#!/usr/bin/env python3
"""Fetch Tally form submissions. Reads token from /tmp/tally_token.txt"""
import json
import subprocess
import sys

with open("/tmp/tally_token.txt") as f:
    token = f.read().strip()

if not token:
    print('{"error": "TALLY_TOKEN not found"}')
    sys.exit(1)

form_id = sys.argv[1] if len(sys.argv) > 1 else "rjpd22"

result = subprocess.run(
    ["curl", "-s", f"https://api.tally.so/forms/{form_id}/submissions",
     "-H", "Authorization: Bearer " + token],
    capture_output=True, text=True, timeout=30
)

resp = json.loads(result.stdout)

if resp.get("items") and len(resp["items"]) > 0:
    for item in resp["items"]:
        sid = item.get("submissionId", "?")
        print(f"\n=== Submission {sid} ===")
        for r in item.get("responses", []):
            q = r.get("question", "")
            a = r.get("answer", "")
            print(f"  {q}")
            print(f"  => {a}")
            print()
else:
    print("NO_SUBMISSIONS")
