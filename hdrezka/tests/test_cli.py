"""Tests for CLI commands."""

from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from hdrezka.cli import cli
from hdrezka.types import ContentInfo, StreamInfo


@pytest.fixture
def mock_content_info():
    """Create mock content info."""
    return ContentInfo(
        id="12345",
        name="Test Movie (2024)",
        type="movie",
        rating={"value": 7.8, "votes": 1234},
        translators=[
            {"id": "1", "name": "Дубляж", "index": 0},
            {"id": "2", "name": "Субтитры", "index": 1},
        ],
        thumbnail="https://example.com/thumb.jpg",
        other_parts=[],
        series_info=[],
    )


@pytest.fixture
def mock_stream_info():
    """Create mock stream info."""
    return StreamInfo(
        url="https://example.com/video_720p.mp4",
        quality="720p",
        translator_id="1",
        translator_name="Дубляж",
        season=None,
        episode=None,
        subtitles={"en": "https://example.com/subs_en.vtt"},
        available_qualities=["360p", "480p", "720p", "1080p"],
    )


class TestInfoCommand:
    """Tests for the info command."""

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_info_command_basic(self, mock_client_class, mock_content_info):
        """Test info command with movie URL."""
        # Setup mock client
        mock_client = MagicMock()
        mock_client.get_content_info.return_value = mock_content_info
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, ["info", "https://hdrezka.ag/movies/action/12345-test-movie.html"])

        assert result.exit_code == 0
        assert "Test Movie (2024)" in result.output

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_info_command_json(self, mock_client_class, mock_content_info):
        """Test info command with JSON output."""
        mock_client = MagicMock()
        mock_client.get_content_info.return_value = mock_content_info
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, ["-j", "info", "https://hdrezka.ag/movies/action/12345-test-movie.html"])

        assert result.exit_code == 0
        assert '"type": "movie"' in result.output

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_info_command_series(self, mock_client_class):
        """Test info command with series URL."""
        # Create mock content info for series
        series_info = ContentInfo(
            id="54321",
            name="Test Series (2024)",
            type="tv_series",
            rating={"value": 8.5, "votes": 2500},
            translators=[
                {"id": "1", "name": "Дубляж", "index": 0},
            ],
            thumbnail="https://example.com/thumb.jpg",
            other_parts=[],
            series_info=[
                {"season": 1, "episodes": 10},
                {"season": 2, "episodes": 8},
            ],
        )

        mock_client = MagicMock()
        mock_client.get_content_info.return_value = series_info
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, ["info", "https://hdrezka.ag/series/drama/54321-test-series.html"])

        assert result.exit_code == 0
        assert "Test Series (2024)" in result.output

    def test_info_command_invalid_url(self):
        """Test info command with invalid URL."""
        runner = CliRunner()
        result = runner.invoke(cli, ["info", "https://example.com/not-hdrezka.html"])

        assert result.exit_code == 1
        # Should fail with error message
        assert "Error" in result.output or "Invalid" in result.output


class TestStreamCommand:
    """Tests for the stream command."""

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_stream_command_basic(self, mock_client_class, mock_stream_info):
        """Test stream command for movie."""
        mock_client = MagicMock()
        mock_client.get_stream.return_value = mock_stream_info
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, ["stream", "https://hdrezka.ag/movies/action/12345-test-movie.html"])

        assert result.exit_code == 0
        assert "https://example.com/video_720p.mp4" in result.output

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_stream_command_json(self, mock_client_class, mock_stream_info):
        """Test stream command with JSON output."""
        mock_client = MagicMock()
        mock_client.get_stream.return_value = mock_stream_info
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, [
            "-j",
            "stream",
            "https://hdrezka.ag/movies/action/12345-test-movie.html"
        ])

        assert result.exit_code == 0
        assert '"video_url":' in result.output

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_stream_command_series(self, mock_client_class, mock_stream_info):
        """Test stream command with season/episode."""
        mock_stream_info.season = 1
        mock_stream_info.episode = 5

        mock_client = MagicMock()
        mock_client.get_stream.return_value = mock_stream_info
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, [
            "stream",
            "https://hdrezka.ag/series/drama/54321-test-series.html",
            "--season", "1",
            "--episode", "5"
        ])

        assert result.exit_code == 0

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_stream_command_quality(self, mock_client_class, mock_stream_info):
        """Test stream command with quality option."""
        mock_client = MagicMock()
        mock_client.get_stream.return_value = mock_stream_info
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, [
            "stream",
            "https://hdrezka.ag/movies/action/12345-test-movie.html",
            "--quality", "1080p"
        ])

        assert result.exit_code == 0


class TestSeasonCommand:
    """Tests for the season command."""

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_season_command_basic(self, mock_client_class):
        """Test season command."""
        # Create mock stream info for episodes
        mock_streams = {
            1: StreamInfo(
                url="https://example.com/s01e01.mp4",
                quality="720p",
                translator_id="1",
                translator_name="Дубляж",
                season=1,
                episode=1,
                subtitles={},
                available_qualities=["720p", "1080p"],
            ),
            2: StreamInfo(
                url="https://example.com/s01e02.mp4",
                quality="720p",
                translator_id="1",
                translator_name="Дубляж",
                season=1,
                episode=2,
                subtitles={},
                available_qualities=["720p", "1080p"],
            ),
        }

        mock_client = MagicMock()
        mock_client.get_season_streams.return_value = mock_streams
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, [
            "season",
            "https://hdrezka.ag/series/drama/54321-test-series.html",
            "--season", "1"
        ])

        assert result.exit_code == 0

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_season_command_json(self, mock_client_class):
        """Test season command with JSON output."""
        mock_streams = {
            1: StreamInfo(
                url="https://example.com/s01e01.mp4",
                quality="720p",
                translator_id="1",
                translator_name="Дубляж",
                season=1,
                episode=1,
                subtitles={},
                available_qualities=["720p"],
            ),
        }

        mock_client = MagicMock()
        mock_client.get_season_streams.return_value = mock_streams
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, [
            "-j",
            "season",
            "https://hdrezka.ag/series/drama/54321-test-series.html",
            "--season", "1"
        ])

        assert result.exit_code == 0
        assert '"season":' in result.output

    @patch("hdrezka.runtime.HdRezkaClient")
    def test_season_command_ignore_errors(self, mock_client_class):
        """Test season command with ignore_errors flag."""
        mock_streams = {
            1: StreamInfo(
                url="https://example.com/s01e01.mp4",
                quality="720p",
                translator_id="1",
                translator_name="Дубляж",
                season=1,
                episode=1,
                subtitles={},
                available_qualities=["720p"],
            ),
        }

        mock_client = MagicMock()
        mock_client.get_season_streams.return_value = mock_streams
        mock_client_class.return_value = mock_client

        runner = CliRunner()
        result = runner.invoke(cli, [
            "season",
            "https://hdrezka.ag/series/drama/54321-test-series.html",
            "--season", "1",
            "--ignore-errors"
        ])

        assert result.exit_code == 0
