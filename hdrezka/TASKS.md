# Implementation Tasks

**Last Updated**: 2026-04-05
**Status**: In Progress

## Phase 1: Core Commands (MVP)

### Project Structure
- [x] Create src/hdrezka package structure
- [x] Set up pyproject.toml with dependencies
- [x] Configure ruff, mypy, pytest
- [x] Create exception hierarchy

### Configuration System
- [x] Implement Config class
- [x] Add file loading
- [x] Add environment variable overrides
- [x] Add config get/set operations
- [x] Add config save functionality
- [ ] Fix TOML null value handling in tests
- [ ] Add config path validation

### Types and Utilities
- [x] Define Quality type
- [x] Define ContentInfo type
- [x] Define StreamInfo type
- [x] Implement parse_quality()
- [x] Implement parse_translator()
- [x] Implement validate_url()
- [x] Implement format_file_name()
- [x] Implement format_bytes()

### Output Formatting
- [x] Implement OutputFormatter class
- [x] Add text formatting
- [x] Add JSON formatting
- [x] Add error formatting
- [x] Add content info formatting
- [x] Add stream info formatting
- [x] Add season streams formatting

### API Client
- [x] Implement HdRezkaClient wrapper
- [x] Add get_content_info()
- [x] Add get_stream()
- [x] Add get_season_streams()
- [ ] Add proper error handling for API failures
- [ ] Add retry logic

### CLI Commands
- [x] Implement `info` command
- [x] Implement `stream` command
- [x] Implement `season` command
- [ ] Implement `download` command
- [ ] Implement `config` command

### Testing
- [x] Add exception tests
- [x] Add config tests (partial - 5 errors)
- [x] Add utils tests
- [ ] Fix config test errors
- [ ] Add CLI tests for info command
- [ ] Add CLI tests for stream command
- [ ] Add CLI tests for season command
- [ ] Add API client tests
- [ ] Add output formatter tests
- [ ] Achieve >80% coverage

## Phase 2: Download Support

### Download Command
- [ ] Implement local download
- [ ] Add progress bar
- [ ] Add resume support
- [ ] Add --dry-run flag
- [ ] Add --no-clobber flag
- [ ] Add multi-thread support
- [ ] Add SSH download support
- [ ] Add subtitle download
- [ ] Add download tests

## Phase 3: Advanced Features

### Config Command
- [ ] Implement `config get` subcommand
- [ ] Implement `config set` subcommand
- [ ] Implement `config list` subcommand
- [ ] Implement `config edit` subcommand
- [ ] Implement `config reset` subcommand

### Additional Features
- [ ] Add shell completion
- [ ] Add man pages
- [ ] Add batch operations
- [ ] Add search functionality

## Phase 4: Polish

### Documentation
- [x] Basic README
- [ ] Add installation examples
- [ ] Add troubleshooting guide
- [ ] Add contributing guidelines
- [ ] Add LICENSE file
- [ ] Add CHANGELOG.md

### CI/CD
- [ ] Add GitHub Actions workflow
- [ ] Add automated testing
- [ ] Add release process

### Packaging
- [x] Make package installable
- [ ] Verify pip install works
- [ ] Add version management
- [ ] Prepare for PyPI release

## Current Blockers

1. **Config test errors**: TOML `null` values cause parsing errors
2. **Low CLI coverage**: No CLI tests yet (0% coverage)
3. **Missing commands**: `download` and `config` commands not implemented

## Next Task

**Fix config test errors** - The test fixture uses `null` values in TOML which the `toml` library doesn't handle properly. This blocks the test suite from passing completely.
