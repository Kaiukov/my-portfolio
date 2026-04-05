# Product Requirements Document: hdrezka-cli

**Version**: 0.1.0
**Last Updated**: 2026-04-05
**Status**: Active Development

## 1. Product Overview

**Product Name**: hdrezka-cli
**Purpose**: Production-ready Python CLI for HdRezkaApi
**Target Users**: Developers and power users who need programmatic access to HDRezka content metadata

### 1.1 Problem Statement
Existing prototype scripts are:
- Not installable as a package
- Lack proper error handling
- Have no test coverage
- Use hardcoded paths
- Have no unified CLI interface

### 1.2 Solution
A comprehensive CLI tool that:
- Exposes all HdRezkaApi functionality
- Is installable via pip
- Has >80% test coverage
- Supports multiple output formats
- Has robust configuration system

## 2. Functional Requirements

### 2.1 Core Commands (Phase 1 - MVP)

#### FR-1: `info` Command
Show content information from HDRezka URL.

**Inputs**:
- URL (required): HDRezka content URL
- Flags: --type, --rating, --translators, --parts, --series, --thumbnail, --all

**Outputs**:
- Human-readable formatted text (default)
- JSON (with --json flag)

**Validation**:
- URL must be valid HDRezka URL
- Handle both movies and TV series

#### FR-2: `stream` Command
Get direct video stream URL.

**Inputs**:
- URL (required): HDRezka content URL
- --quality: Video quality (default: 720p)
- --season, --episode: For TV series
- --translation: Translator ID or name
- --subtitles: Include subtitle URLs
- --all-qualities: Show all available qualities

**Outputs**:
- Direct video URL
- Available qualities
- Subtitle URLs (if requested)

#### FR-3: `season` Command
Get all episode streams for a season.

**Inputs**:
- URL (required)
- --season (required): Season number
- --translation: Translator selection
- --quality: Video quality
- --ignore-errors: Continue on individual failures
- --output: Save to JSON file

**Outputs**:
- JSON with all episodes and URLs

#### FR-4: `download` Command
Download content to local or remote location.

**Inputs**:
- URL (required)
- --output: Output path
- --quality: Video quality
- --season, --episode: For series
- --subtitles: Download subtitles
- --continue: Resume partial downloads
- --dry-run: Show what would be downloaded
- --ssh-*: Remote download options

**Outputs**:
- Downloaded file
- Progress information

#### FR-5: `config` Command
Manage configuration.

**Subcommands**:
- get: Get config value
- set: Set config value
- list: List all config
- edit: Open in editor
- reset: Reset to defaults

### 2.2 Configuration System (FR-6)

**Config File**: `~/.config/hdrezka/config.toml`

**Environment Variables**:
- `HDREZKA_CONFIG`: Override config path
- `HDREZKA_DEFAULT_QUALITY`: Default quality
- `HDREZKA_PROXY`: Proxy URL
- `HDREZKA_TIMEOUT`: Request timeout
- `HDREZKA_SSH_*`: SSH settings

**Config Structure**:
```toml
[default]
quality = "720p"
translator_index = 0
output_directory = "~/Downloads"

[download]
threads = 1
continue = true
timeout = 300
subtitles = false

[output]
json = false
color = true
progress = true

[network]
proxy = null
timeout = 30
retry = 3
retry_delay = 1.0
```

### 2.3 Output Formats (FR-7)

**Human-Readable**:
- Formatted tables
- Colored output (optional)
- Progress bars

**JSON**:
- Structured output
- Error details
- Machine-readable

## 3. Non-Functional Requirements

### NFR-1: Code Quality
- Python 3.13+
- Type hints required
- mypy strict mode
- Ruff linting
- >80% test coverage

### NFR-2: Error Handling
- Custom exception hierarchy
- Clear error messages
- Retry logic for network failures
- Graceful degradation

### NFR-3: Documentation
- CLI help text
- README with examples
- Docstrings for public API
- Type hints throughout

### NFR-4: Portability
- No hardcoded paths
- Cross-platform compatible
- Configurable behavior
- Environment-specific settings

## 4. Out of Scope

Explicitly NOT required:
- GUI application
- Web interface
- Database storage
- User authentication
- Content caching
- Multi-language UI
- Mobile app
- Browser extension

## 5. Success Criteria

The project is complete when:
1. All commands from section 2 are implemented
2. Test coverage >80%
3. All tests pass
4. mypy and ruff pass
5. CLI is installable via pip
6. README has complete usage examples
7. Error handling covers all edge cases
