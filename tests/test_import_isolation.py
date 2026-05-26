"""Verify portfolio_db resolves to the local workspace package, not a sibling repo."""
import sys
from pathlib import Path

import portfolio_db


def test_correct_package_is_imported():
    """portfolio_db.__file__ must point inside this repo, not a sibling."""
    repo_root = Path(__file__).resolve().parents[1]
    pkg_path = Path(portfolio_db.__file__).resolve()
    assert pkg_path.is_relative_to(repo_root), (
        f"Wrong portfolio_db imported: {pkg_path}\n"
        f"Expected it to be inside: {repo_root}\n"
        f"sys.path: {sys.path[:5]}"
    )


def test_workspace_sentinel():
    """Local package carries the _WORKSPACE sentinel."""
    assert hasattr(portfolio_db, "_WORKSPACE"), "Missing _WORKSPACE sentinel"
    assert portfolio_db._WORKSPACE == "my-portfolio"


def test_version_present():
    assert hasattr(portfolio_db, "__version__")
    assert portfolio_db.__version__ == "0.1.0"


def test_cli_has_no_direct_db_con_access():
    """CLI adapter must not call db.con directly — all SQL must go through database.py methods."""
    import ast
    import pathlib
    cli_src = pathlib.Path(__file__).resolve().parents[1] / "portfolio_db" / "cli.py"
    tree = ast.parse(cli_src.read_text())
    violations = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            # flag any .con.execute or .con.cursor chain
            if node.attr in ("execute", "cursor") and isinstance(node.value, ast.Attribute) and node.value.attr == "con":
                violations.append(f"line {node.lineno}: db.con.{node.attr}() call")
    assert not violations, "CLI must not call db.con directly:\n" + "\n".join(violations)
