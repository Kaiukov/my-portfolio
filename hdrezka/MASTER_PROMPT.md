# MASTER PROMPT: HDRezka CLI Development

**Target Model**: GLM-4.7
**Project**: HDRezka CLI - Comprehensive Command-Line Interface
**Based on**: https://github.com/SuperZombi/HdRezkaApi
**Context**: AUDIT_REPORT.md analysis findings

---

## 1. PROJECT OVERVIEW

You are building a production-ready Python CLI tool called `hdrezka-cli` that provides a comprehensive interface to the HdRezkaApi library. This tool will replace the existing prototype scripts with a properly architected, testable, and maintainable application.

### Project Goals

1. **Complete API Coverage**: Expose ALL functionality from HdRezkaApi via CLI commands
2. **Production Quality**: Proper error handling, logging, configuration, testing
3. **Developer Experience**: Intuitive CLI with help, auto-completion, clear output formats
4. **Maintainability**: Clean architecture, type hints, comprehensive tests
5. **Portability**: Works across different environments, no hardcoded paths

### Core Principles

- **Type Safety**: Use type hints everywhere, validate with mypy
- **Test Coverage**: Minimum 80% coverage, mocked external dependencies
- **Error Recovery**: Retry logic, clear error messages, graceful degradation
- **Documentation**: Inline docs, CLI help, README examples
- **Configuration**: Environment variables + config file support
- **Output Formats**: JSON for automation, formatted tables for humans

---

## 2. HDREZKAAPI REFERENCE

Based on https://github.com/SuperZombi/HdRezkaApi

### Installation
```bash
pip install HdRezkaApi>=11.2.2
```

### Core Classes and Methods

#### HdRezkaApi
```python
from HdRezkaApi import HdRezkaApi

url = "https://hdrezka.ag/__YOUR_URL__.html"
rezka = HdRezkaApi(url, proxy={'http': 'http://192.168.0.1:80'})  # proxy optional
```

**Properties**:
- `id` (str): Film post_id
- `name` (str): Film title
- `type` (HdRezkaTVSeries | HdRezkaMovie): Content type
- `thumbnail` (str): Thumbnail URL
- `rating` (HdRezkaRating): Rating object
- `translators` (list): Available translators
- `seriesInfo` (list): Seasons and episodes for TV series
- `otherParts` (list): Related content

**Methods**:
- `getStream(season=None, episode=None, translation=None, index=0)` → HdRezkaStream
- `getSeasonStreams(season, translation=None, index=0, ignore=False, progress=None)` → dict

#### HdRezkaStream
```python
stream = rezka.getStream(1, 5)  # season 1, episode 5

# Get video URL by quality
url = stream('720p')  # Returns direct video URL
url = stream('720')   # Works without 'p'
url = stream(1080)    # Integer works
url = stream('Ultra') # Special quality
url = stream('1080p Ultra') # Combined

# Access all available qualities
videos = stream.videos  # Dict of {resolution: url}

# Metadata
stream.name           # Stream name
stream.translator_id  # Translator ID
stream.season         # Season number (None for movies)
stream.episode        # Episode number (None for movies)

# Subtitles
subs = stream.subtitles
subs.keys            # ['en', 'ru', ...]
subs.subtitles       # {lang_code: {title, link}, ...}
subs('en')           # Get subtitle URL by code
subs('English')      # Get by title
subs(0)              # Get by index
```

#### HdRezkaStreamSubtitles
```python
subtitles = stream.subtitles

# List available subtitles
print(subtitles.keys)        # ['en', 'ru', 'uk']

# Get subtitle URL
url = subtitles('en')        # By code
url = subtitles('English')   # By title
url = subtitles(0)           # By index

# Access all subtitles data
all_subs = subtitles.subtitles  # Full dict
```

#### HdRezkaRating
```python
rating = rezka.rating
rating.value  # float: 7.8
rating.votes  # int: 1234
```

#### Type Checking
```python
from HdRezkaApi import HdRezkaTVSeries, HdRezkaMovie

is_series = rezka.type == HdRezkaTVSeries
is_movie = rezka.type == HdRezkaMovie

# String comparison also works
is_series = rezka.type == "tv_series"
```

---

## 3. CLI COMMAND SPECIFICATIONS

### Global Options
```bash
hdrezka [GLOBAL_OPTIONS] <COMMAND> [COMMAND_OPTIONS]

Global Options:
  -v, --verbose           Increase verbosity (can be used multiple times)
  -q, --quiet             Suppress non-error output
  -j, --json              Output JSON instead of formatted text
  -c, --config PATH       Config file path (default: ~/.config/hdrezka/config.toml)
  --proxy URL             Proxy URL for requests
  --timeout SECONDS       Request timeout (default: 30)
  --no-color              Disable colored output
  -h, --help              Show help
  -V, --version           Show version
```

### Command Structure

#### 1. `info` - Show Content Information
```bash
hdrezka info <URL> [OPTIONS]

Options:
  -t, --type              Show content type only
  -r, --rating            Show rating only
  --translators           Show available translators
  --parts                 Show related content
  --series                Show series info (seasons/episodes)
  --thumbnail             Show thumbnail URL
  --all                   Show all available information

Examples:
  hdrezka info "https://hdrezka.ag/movies/action/12345-movie.html"
  hdrezka info "https://hdrezka.ag/series/drama/54321-series.html" --series
  hdrezka info "URL" --json
```

**Output Format** (human-readable):
```
Name: Example Movie (2024)
Type: Movie
Rating: 7.8/10 (1,234 votes)
Translators: 3 available
Thumbnail: https://example.com/thumb.jpg
```

**Output Format** (JSON):
```json
{
  "id": "12345",
  "name": "Example Movie (2024)",
  "type": "movie",
  "rating": {
    "value": 7.8,
    "votes": 1234
  },
  "translators": [
    {"id": "56", "name": "Дубляж"},
    {"id": "57", "name": "Субтитры"}
  ],
  "thumbnail": "https://example.com/thumb.jpg",
  "otherParts": []
}
```

#### 2. `stream` - Get Stream URL
```bash
hdrezka stream <URL> [OPTIONS]

Options:
  -q, --quality QUALITY   Video quality (default: 720p)
                          Available: 360p, 480p, 720p, 1080p, 2160p, Ultra
  -s, --season NUM        Season number (required for series)
  -e, --episode NUM       Episode number (required for series)
  -t, --translation ID    Translator ID or name (default: first)
  -i, --index NUM         Translator index (default: 0)
  --subtitles             Include subtitle URLs
  --all-qualities         Show all available qualities

Examples:
  # Movie
  hdrezka stream "https://hdrezka.ag/movies/...html"
  hdrezka stream "URL" --quality 1080p

  # Series
  hdrezka stream "URL" --season 1 --episode 5
  hdrezka stream "URL" -s 2 -e 10 -q 1080p -t "Дубляж"

  # With subtitles
  hdrezka stream "URL" --subtitles
```

**Output Format** (human-readable):
```
Stream URL: https://example.com/video.mp4
Quality: 720p
Translator: Дубляж
Subtitles: en, ru
```

**Output Format** (JSON):
```json
{
  "video_url": "https://example.com/video.mp4",
  "quality": "720p",
  "translator": {
    "id": "56",
    "name": "Дубляж"
  },
  "season": null,
  "episode": null,
  "subtitles": {
    "en": "https://example.com/subs_en.vtt",
    "ru": "https://example.com/subs_ru.vtt"
  },
  "available_qualities": ["360p", "480p", "720p", "1080p"]
}
```

#### 3. `season` - Get Full Season Streams
```bash
hdrezka season <URL> --season NUM [OPTIONS]

Options:
  -s, --season NUM        Season number (required)
  -t, --translation ID    Translator ID or name
  -i, --index NUM         Translator index (default: 0)
  --ignore-errors         Continue on individual episode errors
  --progress              Show progress bar
  -o, --output FILE       Save to JSON file

Examples:
  hdrezka season "URL" --season 1
  hdrezka season "URL" -s 1 --progress
  hdrezka season "URL" -s 1 -t "Дубляж" --output season1.json
```

**Output Format** (JSON):
```json
{
  "season": 1,
  "episodes": {
    "1": {
      "episode": 1,
      "url": "https://example.com/e01.mp4",
      "qualities": ["720p", "1080p"]
    },
    "2": {
      "episode": 2,
      "url": "https://example.com/e02.mp4",
      "qualities": ["720p", "1080p"]
    }
  }
}
```

#### 4. `download` - Download Content
```bash
hdrezka download <URL> [OPTIONS]

Options:
  -o, --output PATH       Output file or directory
  -q, --quality QUALITY   Video quality (default: 720p)
  -s, --season NUM        Season number for series
  -e, --episode NUM       Episode number for series
  -t, --translation ID    Translator selection
  --subtitles             Download subtitles if available
  --subtitles-lang CODE   Specific subtitle language (e.g., en, ru)
  --continue              Resume partial downloads
  --no-clobber             Skip existing files
  -n, --dry-run           Show what would be downloaded
  --threads NUM           Download threads (default: 1)
  --ssh-host HOST         Download via SSH to remote host
  --ssh-path PATH         Remote path for SSH downloads
  --ssh-user USER         SSH username

Examples:
  # Local download
  hdrezka download "URL" -o movie.mp4
  hdrezka download "URL" -o "Movies/" --quality 1080p

  # Series episode
  hdrezka download "URL" -s 1 -e 5 -o "Series/S01E05.mp4"

  # Remote download via SSH
  hdrezka download "URL" -o movie.mp4 --ssh-host server.example.com --ssh-path /media/downloads

  # Dry run
  hdrezka download "URL" -o movie.mp4 --dry-run
```

**Output Format**:
```
Downloading: Example Movie (2024)
Quality: 720p
Size: 1.2 GB
Progress: [████████░░] 80% (960MB/1.2GB) ETA: 2m30s
Speed: 8.5 MB/s

Completed: /path/to/movie.mp4
```

#### 5. `search` - Search Content (Future Feature)
```bash
hdrezka search <QUERY> [OPTIONS]

Options:
  -t, --type TYPE         Filter by type (movie, series, cartoon)
  -y, --year YEAR         Filter by year
  -g, --genre GENRE       Filter by genre
  --limit NUM             Max results (default: 20)
  --page NUM              Page number

Examples:
  hdrezka search "matrix"
  hdrezka search "action" --type movie --year 2024
```

#### 6. `config` - Manage Configuration
```bash
hdrezka config <SUBCOMMAND> [OPTIONS]

Subcommands:
  get <KEY>               Get config value
  set <KEY> <VALUE>       Set config value
  list                    List all config
  edit                    Open config in editor
  reset                   Reset to defaults

Examples:
  hdrezka config get default_quality
  hdrezka config set default_quality 1080p
  hdrezka config list
```

---

## 4. PROJECT STRUCTURE

```
hdrezka-cli/
├── src/
│   └── hdrezka/
│       ├── __init__.py
│       ├── __main__.py           # Entry point for `python -m hdrezka`
│       ├── cli.py                # Main CLI using Click/Typer
│       ├── config.py             # Configuration management
│       ├── api.py                # HdRezkaApi wrapper
│       ├── output.py             # Output formatting
│       ├── download.py           # Download logic
│       ├── exceptions.py         # Custom exceptions
│       ├── utils.py              # Utility functions
│       └── types.py              # Type definitions
├── tests/
│   ├── __init__.py
│   ├── conftest.py               # Pytest fixtures
│   ├── test_cli.py
│   ├── test_api.py
│   ├── test_download.py
│   ├── test_output.py
│   └── test_config.py
├── pyproject.toml
├── README.md
├── CHANGELOG.md
├── LICENSE
└── .github/
    └── workflows/
        └── test.yml
```

---

## 5. CONFIGURATION SYSTEM

### Config File Location
- Default: `~/.config/hdrezka/config.toml`
- Override via `--config` flag
- Environment variables override config file

### Config Structure (TOML)
```toml
[default]
quality = "720p"
translator_index = 0
output_directory = "~/Downloads"
ssh_user = "user"

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
retry_delay = 1
```

### Environment Variables
```bash
HDREZKA_CONFIG=/path/to/config.toml
HDREZKA_DEFAULT_QUALITY=1080p
HDREZKA_PROXY=http://proxy:8080
HDREZKA_TIMEOUT=60
HDREZKA_SSH_HOST=server.example.com
HDREZKA_SSH_PATH=/media/downloads
HDREZKA_SSH_USER=user
```

---

## 6. ERROR HANDLING STRATEGY

### Exception Hierarchy
```python
class HdRezkaError(Exception):
    """Base exception for all hdrezka-cli errors"""

class ConfigError(HdRezkaError):
    """Configuration related errors"""

class ApiError(HdRezkaError):
    """HdRezkaApi interaction errors"""

class DownloadError(HdRezkaError):
    """Download related errors"""

class ValidationError(HdRezkaError):
    """Input validation errors"""
```

### Retry Logic
```python
# Network errors: retry with exponential backoff
# API errors: retry up to 3 times
# Validation errors: fail immediately (user error)
```

### Error Messages
```
Error: Invalid URL format
       Expected: https://hdrezka.ag/...
       Got: invalid-url

Error: Failed to fetch stream information
       URL: https://hdrezka.ag/movies/123.html
       Reason: Connection timeout
       Retry 2/3 in 2 seconds...
```

---

## 7. OUTPUT FORMATTING

### Human-Readable Format
```
═══════════════════════════════════════════════════
  Example Movie (2024)
═══════════════════════════════════════════════════
Type:     Movie
Rating:   ★★★★☆ 7.8/10 (1,234 votes)
Quality:  720p, 1080p, 2160p
Size:     1.2 GB
───────────────────────────────────────────────────
Translators:
  1. Дубляж (default)
  2. Субтитры
  3. Оригинал
═══════════════════════════════════════════════════
```

### JSON Format
```json
{
  "success": true,
  "data": { ... },
  "errors": []
}
```

### Progress Bar
```
Downloading: [████████████░░░░░░░░] 60% (720MB/1.2GB) 
Speed: 8.5 MB/s | ETA: 1m45s | 3 errors (retries: 2)
```

---

## 8. TESTING REQUIREMENTS

### Test Structure
```python
# tests/test_cli.py
def test_info_command_movie(cli_runner, mock_rezka_api):
    result = cli_runner.invoke(['info', TEST_URL])
    assert result.exit_code == 0
    assert 'Example Movie' in result.output

def test_info_command_json(cli_runner, mock_rezka_api):
    result = cli_runner.invoke(['info', TEST_URL, '--json'])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data['type'] == 'movie'

# tests/conftest.py
@pytest.fixture
def mock_rezka_api(monkeypatch):
    # Mock HdRezkaApi for testing
    pass
```

### Coverage Requirements
- Unit tests: >80% coverage
- Integration tests: CLI commands with mocked API
- Edge cases: Invalid URLs, network failures, missing data

---

## 9. DEPENDENCIES

### Production Dependencies
```toml
[project]
dependencies = [
    "hdrezkaapi>=11.2.2",
    "click>=8.1.0",          # CLI framework
    "requests>=2.31.0",      # HTTP client
    "tqdm>=4.66.0",          # Progress bars
    "toml>=0.10.2",          # Config parsing
    "rich>=13.7.0",          # Terminal formatting
]
```

### Development Dependencies
```toml
[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-cov>=4.1.0",
    "pytest-mock>=3.11.0",
    "mypy>=1.5.0",
    "ruff>=0.1.0",
    "pre-commit>=3.3.0",
]
```

---

## 10. IMPLEMENTATION PRIORITIES

### Phase 1: Core Commands (MVP)
1. Project structure setup
2. Configuration system
3. `info` command
4. `stream` command
5. Basic error handling
6. README documentation

### Phase 2: Download Support
1. `download` command (local)
2. Progress bars
3. Resume support
4. SSH download support
5. Download tests

### Phase 3: Advanced Features
1. `season` command
2. `config` command
3. Batch operations
4. Search functionality
5. Full test coverage

### Phase 4: Polish
1. Shell completion
2. Man pages
3. Installation scripts
4. CI/CD pipeline
5. Release process

---

## 11. CODING STANDARDS

### Python Version
- Target: Python 3.13+
- Type hints: Required for all functions
- Docstrings: Google style for all public functions

### Code Style
- Linter: Ruff (compatible with Black)
- Type checker: mypy with strict mode
- Line length: 100 characters

### Example Code Style
```python
from typing import Optional
from hdrezka.types import HdRezkaUrl, Quality


def get_stream_url(
    url: HdRezkaUrl,
    quality: Quality = "720p",
    season: Optional[int] = None,
    episode: Optional[int] = None,
) -> str:
    """Get direct stream URL for content.

    Args:
        url: HdRezka content URL
        quality: Video quality (360p, 480p, 720p, 1080p, 2160p)
        season: Season number for TV series
        episode: Episode number for TV series

    Returns:
        Direct video stream URL

    Raises:
        ApiError: If URL fetch fails
        ValidationError: If parameters are invalid

    Example:
        >>> url = "https://hdrezka.ag/movies/action/123-movie.html"
        >>> get_stream_url(url, quality="1080p")
        'https://example.com/video.mp4'
    """
    # Implementation
```

---

## 12. DELIVERABLES

1. **Complete CLI Application** with all specified commands
2. **Test Suite** with >80% coverage
3. **Documentation** (README, man pages, examples)
4. **Configuration System** with file and env var support
5. **Installation Package** (pip installable)
6. **CI/CD Pipeline** for automated testing
7. **Release Notes** documenting all changes

---

## 13. NON-REQUIREMENTS

These are explicitly OUT OF scope:

- GUI application
- Web interface
- Database storage
- User accounts/authentication
- Content caching/server
- Multi-language UI (English only for MVP)
- Mobile app
- Browser extension

---

## 14. SUCCESS CRITERIA

The project is considered complete when:

1. ✅ All commands from section 3 are implemented
2. ✅ Test coverage exceeds 80%
3. ✅ All tests pass with `pytest`
4. ✅ Type checking passes with `mypy`
5. ✅ Linting passes with `ruff`
6. ✅ CLI can be installed via `pip install`
7. ✅ README has complete usage examples
8. ✅ Error handling covers all edge cases
9. ✅ Configuration system works end-to-end
10. ✅ Code follows all style guidelines

---

## 15. DEVELOPMENT NOTES

### Key Challenges to Address

1. **HdRezkaApi Limitations**:
   - No official documentation beyond GitHub README
   - May break silently if site structure changes
   - No error type definitions

2. **Network Reliability**:
   - Implement robust retry logic
   - Handle timeouts gracefully
   - Support proxy configurations

3. **Download Management**:
   - Large file support (multi-GB)
   - Resume interrupted downloads
   - Progress reporting for long operations

4. **SSH Integration**:
   - Secure credential handling
   - Connection pooling
   - Remote command execution

### Testing Strategy

1. **Mock HdRezkaApi**: Never hit real API in tests
2. **Fixture Data**: Store sample responses
3. **Integration Tests**: Test CLI with mocked dependencies
4. **Edge Cases**: Empty responses, network errors, malformed data

### Performance Considerations

1. Lazy loading of API responses
2. Streaming downloads (don't load full file in memory)
3. Parallel downloads for batch operations
4. Caching of metadata

---

## 16. REFERENCE MATERIAL

### Existing Audit Findings (from AUDIT_REPORT.md)

Key issues to avoid:
- ❌ Hardcoded paths
- ❌ Fragile JSON parsing with regex
- ❌ Infinite loops without timeout
- ❌ No test coverage
- ❌ Poor error handling
- ❌ Mixed concerns in single file

Best practices to implement:
- ✅ Type hints everywhere
- ✅ Comprehensive error handling
- ✅ Configuration system
- ✅ Test coverage >80%
- ✅ Clean architecture
- ✅ Proper documentation

---

## 17. GETTING STARTED INSTRUCTIONS

For the AI implementing this:

1. **Read the full audit report** (AUDIT_REPORT.md) to understand existing problems
2. **Study HdRezkaApi documentation** at https://github.com/SuperZombi/HdRezkaApi
3. **Set up project structure** as defined in section 4
4. **Implement Phase 1 commands first** (info, stream)
5. **Add comprehensive tests** for each feature
6. **Document as you go** - README, inline docs, examples
7. **Follow coding standards** from section 11
8. **Test thoroughly** before moving to next phase

---

## 18. AI-SPECIFIC INSTRUCTIONS

### For GLM-4.7 Implementation

1. **Think step by step** - Don't try to implement everything at once
2. **Validate assumptions** - If HdRezkaApi behavior is unclear, create test to verify
3. **Be defensive** - Assume network will fail, data will be malformed
4. **Test first** - Write tests before implementation where possible
5. **Document decisions** - Comment why you chose specific approaches
6. **Ask for clarification** - If requirements are ambiguous, ask

### Common Pitfalls to Avoid

1. Don't hardcode URLs or paths
2. Don't ignore error handling "for now"
3. Don't skip tests "to save time"
4. Don't mix concerns (keep CLI separate from API logic)
5. Don't assume all data will be present
6. Don't create functions that do multiple things

### Quality Checklist

Before marking any feature complete:
- [ ] Code is type-hinted
- [ ] Code has docstrings
- [ ] Tests are written (>80% coverage)
- [ ] Error cases are handled
- [ ] CLI help is clear
- [ ] Examples work
- [ ] Code is linted (ruff)
- [ ] Types are checked (mypy)

---

**END OF MASTER PROMPT**

This prompt provides complete context for building a production-ready HDRezka CLI tool. Follow it systematically, implement phase by phase, and ensure quality at each step.
