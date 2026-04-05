# Existing Project Audit

## 1. Executive Summary

**Project**: HDRezka Downloader Scripts

**What it is**: A minimal Python/bash toolkit for extracting video stream URLs from HDRezka and downloading them to a ZimaOS media server.

**Current maturity**: Prototype/MVP level. The project consists of 3 small scripts (2 Python, 1 bash) totaling ~160 LOC. No tests, no config system, hardcoded paths, minimal error handling.

**Core verdict**: This is a functional but fragile personal automation script. It works for the author's specific setup but lacks production readiness. The project depends on a third-party scraping library for a pirate video site, which raises legal/compliance concerns. The code is clean enough for a weekend project but not maintainable for team use or production deployment.

---

## 2. What the Project Actually Does

**Verified capabilities**:
- Extracts direct video stream URLs from HDRezka pages via `HdRezkaApi` library
- Supports both movies and TV series (with season/episode parameters)
- Outputs stream URLs as JSON for programmatic consumption
- Initiates background downloads to a remote ZimaOS server via SSH/wget
- Monitors download progress remotely
- Lists available translator counts for content

**Claimed but unverified capabilities**:
- Subtitle extraction (code present but execution path unverified)
- Translator selection (code only shows count, not selection)
- Robust error handling (present but minimal)

**Missing capabilities**:
- No retry logic for network failures
- No caching of extracted URLs
- No parallel download support
- No download resumption
- No metadata extraction (title, year, etc.)
- No automatic file naming based on content
- No validation of downloaded files
- No dry-run mode
- No rate limiting or respectful scraping behavior

---

## 3. Repository Structure

```
hdrezka/
├── pyproject.toml          # Minimal project config
├── uv.lock                 # Dependency lock file (23KB+)
├── README.md               # Documentation (3KB)
├── main.py                 # Stub file (7 lines, "Hello world")
└── scripts/
    ├── get_stream.py       # 65 lines - URL extraction
    ├── list_translators.py # 34 lines - Translator count
    └── download_to_zima.sh # 110 lines - SSH/wget orchestration
```

**Entry points**:
- `/root/.local/bin/uv run python scripts/get_stream.py <url> [quality] [season] [episode]`
- `/root/.local/bin/uv run python scripts/list_translators.py <url>`
- `./scripts/download_to_zima.sh <url> [filename] [quality] [season] [episode]`

**Architecture map**:
```
┌─────────────────────────────────────────────────────────┐
│                    User/Trigger                         │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   get_stream.py  list_translators.py  download_to_zima.sh
        │               │                    │
        └───────────────┼────────────────────┘
                        ▼
                  HdRezkaApi (external)
                        │
                        ▼
              hdrezka-home.tv scraping
```

**Issues**:
- `main.py` is a stub file with zero functionality
- No actual Python package structure (no `src/` or package directory)
- Scripts are loose files, not importable modules
- Git repository root is parent directory (`/Users/oleksandrkaiukov/Code`), not project root
- No `.gitignore` specific to this project
- Project is not installable as a package

---

## 4. Runtime and Configuration

**How it runs**:
- Requires Python >=3.13
- Uses `uv` as package manager
- Scripts executed via `uv run python scripts/<script>.py`
- Shell script uses hardcoded `/root/.local/bin/uv` path
- Shell script assumes project at `/root/hdrezka`

**Required config**:
- `ZIMAOS_IP` environment variable (default: `100.127.254.31`)
- SSH access to ZimaOS server with user `kaiukov`
- Write access to `/media/sdb/mp2tb/media/downloads` on remote server
- Network access to `hdrezka-home.tv`
- `HdRezkaApi` Python package (>=11.2.2)

**Risks and missing validation**:
- No validation that URLs are actually HDRezka URLs
- No validation that quality values are supported
- No validation that season/episode numbers are positive integers
- No check if SSH connection is possible before starting operations
- No check if remote directory exists before initiating download
- No check if wget is available on remote server
- Hardcoded paths make script non-portable
- No config file support (all hardcoded or env vars)
- No secrets management (SSH keys assumed to be set up)

---

## 5. CLI Assessment

**Commands**:

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `get_stream.py` | Get video URL | url, [quality], [season], [episode] | JSON with video_url, quality, subtitles |
| `list_translators.py` | Count translators | url | Text output of count |
| `download_to_zima.sh` | Full pipeline | url, [filename], [quality], [season], [episode] | Progress + file info |

**UX quality**:
- **Inconsistent invocation**: Python scripts use `python scripts/<name>.py`, shell script uses `./scripts/<name>.sh`
- **Help text**: Minimal, only prints usage on missing arguments
- **Error messages**: Generic, print to stderr with exit code 1
- **Output format**: Mixed (JSON for Python, colored text for shell)
- **Naming**: `get_stream.py` is verb-noun, `list_translators.py` is verb-noun (consistent)
- **Discoverability**: Poor - no `--help` flag, no command listing

**Consistency issues**:
- Python scripts output structured data (JSON)
- Shell script outputs human-readable colored text
- No unified CLI entrypoint
- No command-line options (only positional arguments)
- Quality parameter has different defaults: `720p` vs unspecified
- Shell script has color output; Python scripts are plain

**Scriptability**:
- `get_stream.py` is scriptable (JSON output)
- `list_translators.py` is not easily scriptable (text count)
- `download_to_zima.sh` is not scriptable (interactive monitoring)
- No `--quiet` or `--json` flags for automation

---

## 6. Code Quality Findings

**Top code smells**:

1. **`main.py` is a stub**: Contains only "Hello world" - completely unused
2. **Hardcoded absolute paths**: `/root/hdrezka`, `/root/.local/bin/uv`, `/media/sdb/mp2tb/media/downloads`
3. **No config validation**: Assumes SSH, wget, remote paths all work
4. **Fragile JSON parsing in shell**: Uses `grep -oP` regex on JSON output instead of proper JSON parser
5. **Infinite loop potential**: Download monitoring loop has no timeout
6. **No type hints**: Python code has no type annotations
7. **Broad exception handling**: `except Exception as e` catches everything
8. **Mixed concerns**: Shell script handles SSH, wget, monitoring, file management all in one
9. **No logging**: Only print statements
10. **Assumes GNU grep**: Uses `-P` (Perl regex) which may not exist on all systems

**Dead code**:
- `main.py` - entirely unused stub
- `stream.subtitles()` in `get_stream.py` - checked but result not meaningfully used

**Coupling issues**:
- Tight coupling to ZimaOS server details
- Tight coupling to specific filesystem paths
- Tight coupling to HDRezka URL structure
- No abstraction layer between scraping and downloading
- Shell script directly parses Python script output

**Error handling issues**:
- Shell script: `set -euo pipefail` is good, but individual SSH failures may not be caught
- Python: Bare `except Exception` with generic error message
- No retry logic for transient failures
- No distinction between fatal and recoverable errors
- Download monitoring loop can hang forever if wget fails silently

**Specific issues by file**:

**`scripts/get_stream.py`**:
- Line 48: `stream.subtitles()` called twice - inefficient
- Line 45: `stream(quality)` - unclear if this is a method call or function call
- No validation that returned URL is actually valid
- No handling for missing quality levels

**`scripts/list_translators.py`**:
- Line 25: Comment says "translators is an int" - unclear API design
- No actual translator listing despite script name
- Minimal functionality for a dedicated script

**`scripts/download_to_zima.sh`**:
- Lines 50-51: Fragile JSON parsing with regex
- Line 72: `nohup ... &` with no PID tracking
- Lines 82-94: Infinite loop with no timeout
- Line 89: Logic appears inverted - `test -f` AND `! grep -q` should probably be OR
- No cleanup of background processes on failure
- No verification that downloaded file is valid video

---

## 7. Dependency Findings

**Good**:
- `hdrezkaapi>=11.2.2` - single external dependency, clearly versioned
- Uses `uv` for fast dependency management
- `uv.lock` provides reproducible builds

**Bad**:
- `HdRezkaApi` is a scraping library for a pirate video site
- No development dependencies defined (no testing, linting, or type checking tools)
- No optional dependencies for different use cases

**Suspicious**:
- `hdrezkaapi` package scrapes `hdrezka-home.tv` - this is a pirated content site
- The package may break without notice if the site changes structure
- Legal risk: depends on unauthorized content access

**Unused/missing**:
- `json` imported at module level in `get_stream.py` instead of top
- `sys` used correctly but could use `argparse` for better CLI
- No `requests` or similar - `HdRezkaApi` handles HTTP internally
- No `pytest` or other testing framework
- No `ruff`, `mypy`, or other quality tools

**Dependency tree** (from uv.lock):
```
hdrezkaapi>=11.2.2
├── beautifulsoup4
│   ├── soupsieve
│   └── typing-extensions
├── certifi
├── charset-normalizer
├── idna
├── requests
│   ├── certifi
│   └── charset-normalizer, idna
└── urllib3
    └── certifi
```

---

## 8. Safety and Compliance Risks

**🚨 LEGAL/COMPLIANCE CONCERNS**:

1. **Pirated content source**: The project explicitly targets `hdrezka-home.tv`, a site that distributes copyrighted content without authorization
2. **Circumvention of access controls**: The `HdRezkaApi` library is designed to extract video streams from a site that does not provide official API access
3. **Terms of service violation**: Automated scraping of HDRezka likely violates the site's terms
4. **Copyright infringement**: Downloading copyrighted content without authorization is illegal in most jurisdictions

**This project should not be extended, deployed in production, or shared publicly in its current form due to significant legal risk.**

**Unsafe operations**:
- Shell script executes remote commands via SSH without validation
- `nohup wget ... &` spawns background processes with no cleanup mechanism
- No validation that downloaded files are actually video files
- No checksum verification of downloads
- No sandboxing or resource limits

**Security/config problems**:
- SSH credentials assumed to be in agent/config (no explicit auth handling)
- No verification of SSH host keys
- Remote paths hardcoded (no validation they exist)
- No input sanitization on URL parameter (passed directly to scraping library)
- No rate limiting could trigger IP bans from target site

**What would make this safer** (but not legal):
- Dry-run mode for testing
- Config validation before operations
- Proper error handling with cleanup
- Resource limits on downloads
- Checksum verification
- Input validation and sanitization

---

## 9. Test Coverage Reality

**What is covered**:
- **Nothing** - No tests exist in the project

**What is not**:
- Unit tests for URL extraction
- Unit tests for translator counting
- Integration tests for SSH commands
- End-to-end tests for download pipeline
- Error case testing
- Edge case testing (invalid URLs, missing qualities, etc.)

**Whether tests can be trusted**:
- N/A - No tests to trust

**Required tests for production**:
1. Mock `HdRezkaApi` to test URL extraction without hitting real site
2. Mock SSH commands to test download orchestration
3. Test error handling paths (network failures, invalid responses)
4. Test edge cases (malformed URLs, unsupported qualities)
5. Integration test with real ZimaOS server (staging environment)

---

## 10. Documentation Reality

**Accurate parts**:
- Installation instructions using `uv`
- Basic usage examples for both movies and series
- File naming conventions (underscores vs spaces/dots)
- Directory structure matches reality
- Quick start examples are correct

**Lies/outdated parts**:
- README mentions `AGENTS.md` and "OpenClaw Python Standard" - these files don't exist
- Documentation says "Project follows OpenClaw Python Standard (see AGENTS.md)" - no evidence of this
- Example URLs use placeholder domain `hdrezka-home.tv` which may not match actual site
- Shell script example shows quotes around parameters but doesn't explain shell escaping

**Missing docs**:
- No architecture documentation
- No API documentation for `HdRezkaApi` usage
- No troubleshooting guide
- No explanation of error codes
- No contribution guidelines
- No license file
- No changelog
- No explanation of legal risks

**Documentation quality**:
- README is clear and well-structured for a small project
- Code has docstrings explaining usage
- Shell script has inline comments
- Missing: developer documentation, legal disclaimers

---

## 11. File-by-File Critical Review

| File | Purpose | Quality | Major Issues | Verdict |
|------|---------|---------|--------------|---------|
| `main.py` | Entry point (stub) | F | Unused, contains only "Hello world" | DELETE |
| `pyproject.toml` | Project config | C | Minimal, no dev dependencies, no metadata | KEEP - expand |
| `uv.lock` | Dependency lock | B | Large but functional, from uv | KEEP - auto-generated |
| `README.md` | Documentation | B+ | Clear but references non-existent files | KEEP - fix references |
| `scripts/get_stream.py` | URL extraction | C | Functional but minimal error handling, no tests | REFACTOR |
| `scripts/list_translators.py` | Translator count | D | Minimal value, could be merged into get_stream | DELETE or MERGE |
| `scripts/download_to_zima.sh` | Download orchestration | D | Fragile JSON parsing, infinite loops, hardcoded paths | REFACTOR to Python |

---

## 12. Top 10 Problems

1. **🚨 Legal/Compliance Risk**: Project targets pirated content site - should not be used in production or shared publicly
2. **No Tests**: Zero test coverage, no way to verify functionality without hitting real site
3. **Hardcoded Paths**: `/root/hdrezka`, `/root/.local/bin/uv` make script non-portable
4. **Fragile JSON Parsing**: Shell script uses regex to parse JSON instead of proper tool
5. **No Config System**: All configuration is hardcoded or via env vars with no validation
6. **Infinite Loop Risk**: Download monitoring has no timeout
7. **Unused Stub File**: `main.py` serves no purpose
8. **No Error Recovery**: Single failure point fails entire pipeline
9. **No Retry Logic**: Network failures cause immediate failure
10. **Mixed Concerns**: Shell script does SSH, wget, monitoring, file management - should be separated

---

## 13. Refactor Roadmap

### Phase 1: Stabilize (Low Risk)

**Goals**: Make the existing code safer and more robust without changing functionality.

**Changes**:
- Add timeout to download monitoring loop in `download_to_zima.sh`
- Fix inverted logic in line 89 (or clarify intent)
- Add PID tracking for background wget process
- Add cleanup trap for interrupted downloads
- Add validation that remote directory exists before download
- Replace regex JSON parsing with `jq` or Python-based parsing
- Make paths configurable via env vars with defaults

**Files affected**: `scripts/download_to_zima.sh`

**Risk level**: Low - defensive improvements only

### Phase 2: Clean Architecture (Medium Risk)

**Goals**: Separate concerns and make code more maintainable.

**Changes**:
- Convert `download_to_zima.sh` to Python (`scripts/download.py`)
- Create config module for paths and settings
- Create SSH wrapper module for remote operations
- Create proper CLI entrypoint using `click` or `typer`
- Delete unused `main.py`
- Merge `list_translators.py` into `get_stream.py` as subcommand
- Add proper error handling with custom exceptions
- Add logging module

**Files affected**:
- New: `scripts/download.py`, `hdrezka/config.py`, `hdrezka/ssh.py`, `hdrezka/cli.py`
- Modified: `scripts/get_stream.py`
- Deleted: `main.py`, `scripts/list_translators.py`, `scripts/download_to_zima.sh`

**Risk level**: Medium - rewrite of shell script to Python

### Phase 3: Feature Completion (Medium Risk)

**Goals**: Add missing features for production use.

**Changes**:
- Add retry logic with exponential backoff
- Add download resumption support
- Add metadata extraction (title, year, etc.)
- Add automatic file naming based on content metadata
- Add dry-run mode
- Add `--quiet` and `--verbose` modes
- Add parallel download support for batch operations
- Add download queue management
- Add checksum verification

**Files affected**: All scripts, new `hdrezka/metadata.py`, `hdrezka/downloader.py`

**Risk level**: Medium - new features require testing

### Phase 4: Test Hardening (Low Risk)

**Goals**: Achieve >80% test coverage.

**Changes**:
- Add `pytest` to dev dependencies
- Mock `HdRezkaApi` for unit tests
- Mock SSH for integration tests
- Add property-based testing for edge cases
- Add CLI testing with `CliRunner`
- Add end-to-end test with staging server
- Set up CI/CD pipeline

**Files affected**: New `tests/` directory with full test suite

**Risk level**: Low - tests don't change production code

### Phase 5: Docs and Packaging (Low Risk)

**Goals**: Make project installable and well-documented.

**Changes**:
- Fix README references to non-existent files
- Add legal disclaimer to README
- Add LICENSE file
- Add CONTRIBUTING.md
- Add proper package structure (`src/hdrezka/`)
- Make package installable via `pip install .`
- Add `__init__.py` and proper exports
- Add type hints throughout
- Add API documentation
- Add installation instructions for different platforms
- Add troubleshooting guide

**Files affected**: Project structure, all docs, new `src/hdrezka/` directory

**Risk level**: Low - documentation and structure changes

---

## 14. Final Verdict

**Is this project salvageable?**: Yes, technically. The core functionality works and the code is not fundamentally broken.

**What should be kept**:
- The basic workflow (URL extraction → download)
- The JSON output format from `get_stream.py`
- The use of `uv` for dependency management
- The clear README structure

**What should be ripped out**:
- The targeting of pirated content sites (rebuild for legitimate content sources)
- The shell script entirely (rewrite in Python)
- Hardcoded paths and assumptions about specific infrastructure
- The `main.py` stub file
- The separate `list_translators.py` script (merge as subcommand)
- Fragile JSON parsing with regex

**Recommendation**:
This project is a functional prototype for personal use but is not ready for production deployment or public sharing. The legal risk from targeting pirated content is the primary blocker. If the user wants to make this a legitimate project, they should:

1. Rebuild the scraping layer to target legitimate content sources or official APIs
2. Complete the refactor roadmap above
3. Add comprehensive tests
4. Add proper error handling and retry logic
5. Make it configurable and portable
6. Add legal disclaimers and license

If this is only for personal use with full understanding of legal risks, the minimal fixes from Phase 1 would make it safer to operate, but it should never be deployed in a corporate environment or shared publicly.

---

**Audit completed**: 2026-04-05
**Auditor**: Claude Code (read-only analysis)
**Lines of code analyzed**: ~160 LOC (excluding uv.lock)
**Files analyzed**: 7 files (2 Python, 1 shell, 1 config, 1 docs, 1 stub, 1 lock)
