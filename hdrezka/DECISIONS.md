# Project Decisions

**Last Updated**: 2026-04-05

## Architectural Decisions

### D-1: Package Structure
**Decision**: Use src/hdrezka layout with pyproject.toml
**Rationale**: Standard Python packaging, better for testing, prevents import issues
**Date**: 2026-04-05

### D-2: CLI Framework
**Decision**: Use Click for CLI
**Rationale**: Well-established, good documentation, supports nested commands
**Date**: 2026-04-05

### D-3: Configuration Format
**Decision**: Use TOML for config files
**Rationale**: Human-readable, standard in Python ecosystem, supports nested structures
**Date**: 2026-04-05
**Note**: The `toml` library has issues with `null` values - use empty strings or omit keys

### D-4: Type Hints
**Decision**: Required for all functions, mypy strict mode
**Rationale**: Catch errors early, better IDE support, self-documenting
**Date**: 2026-04-05

### D-5: Testing Strategy
**Decision**: Mock HdRezkaApi, never hit real API in tests
**Rationale**: Fast, reliable, no external dependencies
**Date**: 2026-04-05

### D-6: Output Formats
**Decision**: Support both human-readable and JSON output
**Rationale**: Scriptability for automation, readability for humans
**Date**: 2026-04-05

## Pending Decisions

### PD-1: Download Implementation
**Status**: Pending
**Options**:
1. Use requests with streaming
2. Use specialized download library (wget, curl wrapper)
3. Implement custom downloader

### PD-2: SSH Implementation
**Status**: Pending
**Options**:
1. Use paramiko
2. Use subprocess with ssh command
3. Use asyncssh

### PD-3: Progress Bars
**Status**: Pending
**Options**:
1. Use tqdm
2. Use rich.progress
3. Use click.progressbar

## Technical Decisions Log

### T-1: TOML Null Values (2026-04-05)
**Issue**: The `toml` library doesn't parse `null` values properly
**Resolution**: Use empty strings or omit keys entirely instead of `null`
**Impact**: Test fixtures need to be updated

### T-2: Exception Hierarchy (2026-04-05)
**Decision**: Create custom exception hierarchy inheriting from HdRezkaError
**Classes**:
- HdRezkaError (base)
- ConfigError
- ApiError
- NetworkError
- ValidationError
- QualityError
- TranslatorError
- DownloadError

## Scope Decisions

### Out of Scope
- GUI application
- Web interface
- Database storage
- User authentication
- Content caching
- Multi-language UI
- Mobile app
- Browser extension

### In Scope (MVP)
- Core CLI commands (info, stream, season)
- Configuration system
- Download to local filesystem
- SSH download to remote server
- JSON and text output
- Error handling and retry logic
