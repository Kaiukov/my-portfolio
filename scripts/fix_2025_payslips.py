#!/usr/bin/env python3
"""Download all files from 2025 Drive folder, rename consistently, zip."""
import json, subprocess, os, sys, shutil, mimetypes

GAPI = "python /root/.hermes/profiles/financial/skills/productivity/google-workspace/scripts/google_api.py"
FOLDER_ID = "19SvNFoYB3eoivZ-DAQmV0E_u4OgfKEeT"
DL_DIR = "/root/.hermes/profiles/financial/2025_download"

def shell(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, shell=True, timeout=60)

# 1. List files
print("=== Listing files in 2025 folder ===")
r = shell(f'{GAPI} drive search \'{FOLDER_ID}\' --raw-query --max 30')
files = json.loads(r.stdout)

for f in files:
    fid = f["id"]
    fname = f["name"]
    mime = f.get("mimeType", "")
    print(f"  {fid}  {fname}  [{mime}]")

print(f"\nTotal: {len(files)} files")
