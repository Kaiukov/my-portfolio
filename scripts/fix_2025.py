#!/usr/bin/env python3
"""Process & rename """
import json, subprocess, os, sys

GAPI_BASE = ["python3", "/root/.hermes/profiles/financial/skills/productivity/google-workspace/scripts/google_api.py"]
DL_DIR = "/root/.hermes/profiles/financial/2025_download"
os.makedirs(DL_DIR, exist_ok=True)
PAYSLIPS_ID = "19SvNFoYB3eoivZ-DAQmV0E_u4OgfKEeT"

def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    return result.stdout

# List files
print("=== Listing 2025 folder ===")
files_json = run(GAPI_BASE + ["drive", "search", f"'{PAYSLIPS_ID}' in parents", "--raw-query", "--max", "30"])
files = json.loads(files_json)

# Download each file
for f in files:
    fid = f["id"]
    fname = f["name"]
    ext = os.path.splitext(fname)[1]
    # Determine clean name
    mime = f.get("mimeType", "")
    
    # Map to clean name
    clean = fname
    if fname == "09.2025" and mime == "application/pdf":
        clean = "09.2025.pdf"
    elif fname == "12.2025.html.pdf":
        clean = "12.2025.pdf"
    elif fname == "11.2025.html.pdf":
        clean = "11.2025.pdf"
    elif fname == "10.2025.html.pdf":
        clean = "10.2025.pdf"
    elif fname == "forwardToPaySlipPDF.html.pdf":
        # Keep original name for now, will identify later
        clean = "forwardToPaySlipPDF.html.pdf"
    elif fname == "TideWater-2025.pdf":
        clean = "TideWater-2025.pdf"
    elif fname == "Atlas-2025.pdf":
        clean = "Atlas-2025.pdf"
    elif fname == "10.2025":
        clean = "10.2025"  # keep to check
        
    outpath = os.path.join(DL_DIR, clean)
    
    print(f"  Downloading: {fname} -> {clean}")
    out = run(GAPI_BASE + ["drive", "download", fid, "--output", outpath])
    print(f"    {out.strip()[:100]}")

print("\n=== Downloaded files ===")
for f in sorted(os.listdir(DL_DIR)):
    fpath = os.path.join(DL_DIR, f)
    size = os.path.getsize(fpath)
    print(f"  {f:40s} {size:>8,} bytes")
