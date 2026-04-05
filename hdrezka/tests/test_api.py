"""Tests for HdRezkaClient wrapper."""

from unittest.mock import MagicMock, patch

import pytest

from hdrezka.api import HdRezkaClient
from hdrezka.exceptions import (
    NetworkError,
    QualityError,
    TranslatorError,
    ValidationError,
)


class TestHdRezkaClientInit:
    """Tests for HdRezkaClient initialization."""

    @patch("hdrezka.api.HdRezkaApi")
    def test_client_init_with_valid_url(self, mock_api_class):
        """Test client initialization with valid URL."""
        mock_api = MagicMock()
        mock_api.id = "12345"
        mock_api.name = "Test Movie"
        mock_api.type = "movie"
        mock_api.rating = MagicMock(value=7.8, votes=1234)
        mock_api.translators = []
        mock_api.seriesInfo = []
        mock_api.otherParts = []
        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/movies/action/12345-test.html")

        assert client.url == "https://hdrezka.ag/movies/action/12345-test.html"
        assert client.id == "12345"
        assert client.name == "Test Movie"

    @patch("hdrezka.api.HdRezkaApi")
    def test_client_init_with_invalid_url_format(self, mock_api_class):
        """Test client initialization with invalid URL format."""
        mock_api_class.return_value = MagicMock()

        with pytest.raises(ValidationError) as exc_info:
            HdRezkaClient("not-a-url")

        assert "URL must start with http:// or https://" in str(exc_info.value)

    @patch("hdrezka.api.HdRezkaApi")
    def test_client_init_with_invalid_domain(self, mock_api_class):
        """Test client initialization with invalid domain."""
        mock_api_class.return_value = MagicMock()

        with pytest.raises(ValidationError) as exc_info:
            HdRezkaClient("https://example.com/video.html")

        assert "does not appear to be a valid HdRezka URL" in str(exc_info.value)

    @patch("hdrezka.api.HdRezkaApi")
    def test_client_init_with_api_failure(self, mock_api_class):
        """Test client initialization when API fails."""
        mock_api_class.side_effect = Exception("Connection failed")

        with pytest.raises(NetworkError) as exc_info:
            HdRezkaClient("https://hdrezka.ag/movies/action/12345-test.html")

        assert "Failed to initialize HdRezkaApi" in str(exc_info.value)


class TestContentInfoExtraction:
    """Tests for content information extraction."""

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_content_info_movie(self, mock_api_class):
        """Test content info extraction for movies."""
        # Setup mock API for movie
        mock_api = MagicMock()
        mock_api.id = "12345"
        mock_api.name = "Test Movie (2024)"
        mock_api.type = "movie"
        mock_api.thumbnail = "https://example.com/thumb.jpg"

        mock_rating = MagicMock()
        mock_rating.value = 7.8
        mock_rating.votes = 1234
        mock_api.rating = mock_rating

        mock_api.translators = [
            {"id": "1", "name": "Дубляж"},
            {"id": "2", "name": "Субтитры"},
        ]
        mock_api.seriesInfo = []
        mock_api.otherParts = []

        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/movies/action/12345-test.html")
        content_info = client.get_content_info()

        assert content_info.id == "12345"
        assert content_info.name == "Test Movie (2024)"
        assert content_info.type == "movie"
        assert content_info.rating["value"] == 7.8
        assert content_info.translators[0]["name"] == "Дубляж"
        assert len(content_info.series_info) == 0

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_content_info_series(self, mock_api_class):
        """Test content info extraction for TV series."""
        from HdRezkaApi import TVSeries

        # Setup mock API for series
        mock_api = MagicMock()
        mock_api.id = "54321"
        mock_api.name = "Test Series (2024)"
        mock_api.type = TVSeries
        mock_api.thumbnail = "https://example.com/thumb.jpg"

        mock_rating = MagicMock()
        mock_rating.value = 8.5
        mock_rating.votes = 2500
        mock_api.rating = mock_rating

        mock_api.translators = [{"id": "1", "name": "Дубляж"}]

        mock_api.seriesInfo = [
            {"season": 1, "episodes": 10},
            {"season": 2, "episodes": 8},
        ]
        mock_api.otherParts = []

        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/series/drama/54321-test.html")
        content_info = client.get_content_info()

        assert content_info.type == "tv_series"
        assert content_info.series_info[0]["season"] == 1
        assert content_info.series_info[0]["episodes"] == 10


class TestStreamExtraction:
    """Tests for stream URL extraction."""

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_stream_movie(self, mock_api_class, mock_stream):
        """Test stream extraction for movies."""
        mock_api = self._create_mock_api_for_stream(mock_stream)
        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/movies/action/12345-test.html")
        stream_info = client.get_stream()

        assert stream_info.url == "https://example.com/video_720p.mp4"
        assert stream_info.quality == "720p"
        assert stream_info.season is None
        assert stream_info.episode is None

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_stream_series(self, mock_api_class, mock_stream):
        """Test stream extraction with season/episode."""
        mock_api = self._create_mock_api_for_stream(mock_stream)
        from HdRezkaApi import TVSeries

        mock_api.type = TVSeries
        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/series/drama/54321-test.html")

        stream_info = client.get_stream(season=1, episode=5)

        assert stream_info.season == 1
        assert stream_info.episode == 5

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_stream_with_quality(self, mock_api_class, mock_stream):
        """Test stream extraction with custom quality."""
        mock_api = self._create_mock_api_for_stream(mock_stream)
        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/movies/action/12345-test.html")
        stream_info = client.get_stream(quality="1080p")

        assert stream_info.quality == "1080p"
        assert stream_info.url == "https://example.com/video_1080p.mp4"

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_stream_movie_with_season_raises_error(self, mock_api_class):
        """Test that providing season/episode for movie raises error."""
        mock_api = MagicMock()
        mock_api.type = "movie"
        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/movies/action/12345-test.html")

        with pytest.raises(ValidationError) as exc_info:
            client.get_stream(season=1)

        assert "Season/episode only valid for TV series" in str(exc_info.value)

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_stream_series_without_season_raises_error(self, mock_api_class):
        """Test that series without season/episode raises error."""
        from HdRezkaApi import TVSeries

        mock_api = MagicMock()
        mock_api.type = TVSeries
        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/series/drama/54321-test.html")

        with pytest.raises(ValidationError) as exc_info:
            client.get_stream()

        assert "Season and episode are required for TV series" in str(exc_info.value)

    def _create_mock_api_for_stream(self, mock_stream):
        """Create a mock API that returns a mock stream."""
        mock_api = MagicMock()
        mock_api.id = "12345"
        mock_api.name = "Test Movie"
        mock_api.type = "movie"
        mock_api.rating = MagicMock(value=7.8, votes=1234)
        mock_api.translators = [{"id": "1", "name": "Дубляж"}]
        mock_api.seriesInfo = []
        mock_api.otherParts = []

        # Mock getStream to return mock_stream
        mock_api.getStream.return_value = mock_stream

        return mock_api


class TestTranslatorResolution:
    """Tests for translator resolution."""

    def test_resolve_translator_by_id(self):
        """Test resolving translator by ID."""
        client = HdRezkaClient.__new__(HdRezkaClient)
        client._api = MagicMock()
        client._api.translators = [
            {"id": "1", "name": "Дубляж"},
            {"id": "2", "name": "Субтитры"},
        ]

        result = client._resolve_translator("1", 0)
        assert result == "1"

    def test_resolve_translator_by_name(self):
        """Test resolving translator by name."""
        client = HdRezkaClient.__new__(HdRezkaClient)
        client._api = MagicMock()
        client._api.translators = [
            {"id": "1", "name": "Дубляж"},
            {"id": "2", "name": "Субтитры"},
        ]

        result = client._resolve_translator("Дубляж", 0)
        assert result == "1"

    def test_resolve_translator_by_index(self):
        """Test resolving translator by index."""
        client = HdRezkaClient.__new__(HdRezkaClient)
        client._api = MagicMock()
        client._api.translators = [
            {"id": "1", "name": "Дубляж"},
            {"id": "2", "name": "Субтитры"},
        ]

        result = client._resolve_translator(None, 1)
        assert result == "2"

    def test_resolve_translator_not_found(self):
        """Test resolving non-existent translator."""
        client = HdRezkaClient.__new__(HdRezkaClient)
        client._api = MagicMock()
        client._api.translators = [
            {"id": "1", "name": "Дубляж"},
        ]

        with pytest.raises(TranslatorError) as exc_info:
            client._resolve_translator("Invalid", 0)

        assert "Translator not found" in str(exc_info.value)


class TestSeasonStreams:
    """Tests for season stream extraction."""

    @patch("hdrezka.api.HdRezkaApi")
    def test_get_season_streams(self, mock_api_class):
        """Test getting all streams for a season."""
        # Setup mock API
        mock_api = MagicMock()
        mock_api.id = "54321"
        mock_api.name = "Test Series"
        mock_api.type = "tv_series"
        mock_api.translators = [{"id": "1", "name": "Дубляж"}]
        mock_api.seriesInfo = [{"season": 1, "episodes": 2}]
        mock_api.otherParts = []

        mock_stream = MagicMock()
        mock_stream.side_effect = lambda _quality: "https://example.com/video_720p.mp4"
        mock_stream.videos = {"720p": "https://example.com/video_720p.mp4"}
        mock_stream.subtitles = None
        mock_api.getStream.return_value = mock_stream

        mock_api_class.return_value = mock_api

        client = HdRezkaClient("https://hdrezka.ag/series/drama/54321-test.html")
        streams = client.get_season_streams(season=1)

        assert len(streams) == 2
        assert 1 in streams
        assert 2 in streams


class TestQualityExtraction:
    """Tests for quality URL extraction."""

    def test_get_quality_url_valid_quality(self):
        """Test getting URL for valid quality."""
        client = HdRezkaClient.__new__(HdRezkaClient)

        # Mock stream
        mock_stream = MagicMock()
        mock_stream.side_effect = lambda _q: "https://example.com/video_1080p.mp4"
        mock_stream.videos = {"1080p": "https://example.com/video_1080p.mp4"}

        result = client._get_quality_url(mock_stream, "1080p")
        assert result == "https://example.com/video_1080p.mp4"

    def test_get_quality_url_invalid_quality(self):
        """Test getting URL for invalid quality."""
        client = HdRezkaClient.__new__(HdRezkaClient)

        # Mock stream with no requested quality
        mock_stream = MagicMock()
        mock_stream.side_effect = lambda _q: None
        mock_stream.videos = {"720p": "https://example.com/video_720p.mp4"}

        with pytest.raises(QualityError) as exc_info:
            client._get_quality_url(mock_stream, "999p")

        assert "Quality not available" in str(exc_info.value)
