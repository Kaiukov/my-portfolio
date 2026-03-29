import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
repo_str = str(REPO_ROOT)

if repo_str not in sys.path:
    sys.path.insert(0, repo_str)
