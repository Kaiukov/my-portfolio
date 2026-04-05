"""Tests for utility functions."""

import pytest

from hdrezka.utils import (
    format_bytes,
    format_file_name,
    parse_quality,
    parse_translator,
    validate_url,
)


class TestParseQuality:
    """Tests for parse_quality function."""

    def test_parse_quality_string_with_p(self):
        assert parse_quality("720p") == "720p"
        assert parse_quality("1080p") == "1080p"

    def test_parse_quality_string_without_p(self):
        assert parse_quality("720") == "720p"
        assert parse_quality("1080") == "1080p"

    def test_parse_quality_int(self):
        assert parse_quality(720) == "720p"
        assert parse_quality(1080) == "1080p"

    def test_parse_quality_none(self):
        assert parse_quality(None) == "720p"

    def test_parse_quality_ultra(self):
        assert parse_quality("Ultra") == "Ultra"
        assert parse_quality("ULTRA") == "Ultra"
        assert parse_quality("2160p") == "2160p"

    def test_parse_quality_invalid(self):
        from hdrezka.exceptions import ValidationError
        with pytest.raises(ValidationError):
            parse_quality("invalid")
        with pytest.raises(ValidationError):
            parse_quality("999p")


class TestParseTranslator:
    """Tests for parse_translator function."""

    def test_parse_translator_none(self):
        assert parse_translator(None, []) is None

    def test_parse_translator_int_valid(self):
        translators = [
            {"id": "1", "name": "Dub"},
            {"id": "2", "name": "Sub"},
        ]
        assert parse_translator(0, translators) == 0
        assert parse_translator(1, translators) == 1

    def test_parse_translator_int_invalid(self):
        from hdrezka.exceptions import ValidationError
        translators = [{"id": "1", "name": "Dub"}]
        with pytest.raises(ValidationError):
            parse_translator(5, translators)

    def test_parse_translator_by_name(self):
        translators = [
            {"id": "1", "name": "Дубляж"},
            {"id": "2", "name": "Субтитры"},
        ]
        result = parse_translator("Дубляж", translators)
        assert result == "1"

    def test_parse_translator_by_id(self):
        translators = [
            {"id": "1", "name": "Dub"},
            {"id": "2", "name": "Sub"},
        ]
        result = parse_translator("2", translators)
        assert result == "2"


class TestFormatFileName:
    """Tests for format_file_name function."""

    def test_format_file_name_movie(self):
        assert format_file_name("Test Movie") == "Test Movie.mp4"
        assert format_file_name("Test Movie", extension="mkv") == "Test Movie.mkv"

    def test_format_file_name_series(self):
        assert format_file_name("Test Series", season=1, episode=5) == "Test Series.S01E05.mp4"
        assert format_file_name("Test Series", season=2) == "Test Series.S02.mp4"

    def test_format_file_name_clean_invalid_chars(self):
        assert format_file_name("Test/Movie:Name") == "TestMovieName.mp4"
        assert format_file_name("Test<>Movie|Name?") == "TestMovieName.mp4"


class TestFormatBytes:
    """Tests for format_bytes function."""

    def test_format_bytes_small(self):
        assert format_bytes(512) == "512.0 B"
        assert format_bytes(1024) == "1.0 KB"

    def test_format_bytes_medium(self):
        assert format_bytes(1024 * 1024) == "1.0 MB"
        assert format_bytes(5 * 1024 * 1024) == "5.0 MB"

    def test_format_bytes_large(self):
        assert format_bytes(1024 * 1024 * 1024) == "1.0 GB"
        assert format_bytes(1024 * 1024 * 1024 * 1024) == "1.0 TB"


class TestValidateUrl:
    """Tests for validate_url function."""

    def test_validate_url_valid_hdrezka(self):
        assert validate_url("https://hdrezka.ag/movies/test.html") is True
        assert validate_url("https://hdrezka.tv/series/test.html") is True
        assert validate_url("http://hdrezka.ink/cartoon/test.html") is True

    def test_validate_url_invalid_domain(self):
        assert validate_url("https://example.com/test.html") is False
        assert validate_url("https://youtube.com/watch?v=test") is False

    def test_validate_url_invalid_format(self):
        assert validate_url("not-a-url") is False
        assert validate_url("") is False
        assert validate_url(None) is False
