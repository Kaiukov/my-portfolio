# Next Task

**Loop**: 4
**Date**: 2026-04-05

## Completed in Loop 3
- Created tests/test_cli.py with 11 CLI tests
- All CLI tests pass (11/11)
- Coverage increased from 37% to 67%
- CLI coverage: 70% (was 0%)
- types.py: 100% coverage
- config.py: 89% coverage
- exceptions.py: 100% coverage

## Completed in Loop 2
- Fixed all 37 mypy type annotation errors
- Fixed all 7 ruff linting errors
- Restored missing `timeout` property
- Mypy: 0 errors
- Ruff: 0 errors

## Completed in Loop 1
- Fixed TOML null value parsing
- Fixed shallow copy bug
- Created control files

## Immediate Next Task

### Add API Client Tests

**Priority**: HIGH - Required to increase api.py coverage from 25% to >60%

**Tests to Add**:
1. `test_client_init_with_valid_url` - Test client initialization
2. `test_client_init_with_invalid_url` - Test URL validation
3. `test_client_init_with_api_failure` - Test API initialization error handling
4. `test_get_content_info_movie` - Test content info extraction for movies
5. `test_get_content_info_series` - Test content info for TV series
6. `test_get_stream_movie` - Test stream extraction for movies
7. `test_get_stream_series` - Test stream extraction with season/episode
8. `test_get_season_streams` - Test full season stream extraction
9. `test_resolve_translator_by_id` - Test translator resolution
10. `test_resolve_translator_by_name` - Test translator name lookup

**Files to Modify**:
- tests/test_api.py (create new file)

**Mocking Strategy**:
- Mock HdRezkaApi class for successful API calls
- Mock API failures (network errors, invalid responses)
- Use fixtures for sample data

**Verification**:
- Run `pytest tests/test_api.py -v` - all tests pass
- Run `pytest --cov=hdrezka.api` - increase coverage to >60%
- Overall coverage target: >75%

**Estimated Time**: 30 minutes

## Following Tasks (After API Tests)

1. Add output formatter tests (increase output.py coverage from 83%)
2. Implement `download` command (Phase 2)
3. Implement `config` command (Phase 3)
4. Achieve >80% overall coverage (project goal)

## Blockers

None
