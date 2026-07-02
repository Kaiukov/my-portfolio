"""Get Tally form submissions."""
import json, subprocess

with open("/root/.hermes/profiles/financial/.env") as f:
    token = None
    for line in f:
        line = line.strip()
        if line.startswith("TALLY_API_TOKEN="):
            token = line.split("=", 1)[1]
            break

if not token:
    print("ERROR: TALLY_API_TOKEN not found")
    exit(1)

form_id = "rjpd22"

result = subprocess.run([
    "curl", "-s", f"https://api.tally.so/forms/{form_id}/submissions",
    "-H", f"Authorization: Bearer {token}",
], capture_output=True, text=True, timeout=30)

resp = json.loads(result.stdout)
print(json.dumps(resp, indent=2, ensure_ascii=False))
