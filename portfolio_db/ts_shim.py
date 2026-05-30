"""Thin shim that delegates `portfolio` CLI calls to the TypeScript/Bun binary."""

import subprocess
import sys
from pathlib import Path


def main() -> None:
    ts_cli = Path(__file__).parent.parent / "portfolio-ts" / "src" / "cli.ts"
    result = subprocess.run(["bun", str(ts_cli), *sys.argv[1:]])
    sys.exit(result.returncode)
