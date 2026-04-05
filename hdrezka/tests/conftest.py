"""Pytest fixtures for hdrezka-cli tests."""

from unittest.mock import MagicMock

import pytest

from hdrezka.config import Config
from hdrezka.types import ContentInfo, StreamInfo


@pytest.fixture
def sample_config(tmp_path):
    """Create a sample config for testing."""
    config_file = tmp_path / "config.toml"
    config_file.write_text("""
[default]
quality = "720p"
translator_index = 0
output_directory = "~/Downloads"

[download]
threads = 1
continue = true
timeout = 300

[output]
json = false
color = true
progress = true

[network]
proxy = ""
timeout = 30
retry = 3
retry_delay = 1.0
""")
    return Config(config_file)


@pytest.fixture
def mock_rezka_api():
    """Create a mock HdRezkaApi object."""
    mock = MagicMock()

    # Basic properties
    mock.id = "12345"
    mock.name = "Test Movie (2024)"
    mock.type = "movie"  # or HdRezkaMovie
    mock.thumbnail = "https://example.com/thumb.jpg"

    # Rating
    mock_rating = MagicMock()
    mock_rating.value = 7.8
    mock_rating.votes = 1234
    mock.rating = mock_rating

    # Translators
    mock.translators = [
        {"id": "1", "name": "Дубляж"},
        {"id": "2", "name": "Субтитры"},
    ]

    # Series info (empty for movies)
    mock.seriesInfo = []
    mock.otherParts = []

    return mock


@pytest.fixture
def mock_stream():
    """Create a mock HdRezkaStream object."""
    mock = MagicMock()

    # Stream URL by quality
    def quality_caller(quality):
        urls = {
            "360p": "https://example.com/video_360p.mp4",
            "480p": "https://example.com/video_480p.mp4",
            "720p": "https://example.com/video_720p.mp4",
            "1080p": "https://example.com/video_1080p.mp4",
            "2160p": "https://example.com/video_2160p.mp4",
        }
        return urls.get(quality, urls["720p"])

    mock.side_effect = quality_caller

    # Available videos
    mock.videos = {
        "720p": "https://example.com/video_720p.mp4",
        "1080p": "https://example.com/video_1080p.mp4",
    }

    # Metadata
    mock.name = "Test Stream"
    mock.translator_id = "1"
    mock.season = None
    mock.episode = None

    # Subtitles
    mock_subs = MagicMock()
    mock_subs.keys = ["en", "ru"]
    mock_subs.subtitles = {
        "en": {"title": "English", "link": "https://example.com/subs_en.vtt"},
        "ru": {"title": "Russian", "link": "https://example.com/subs_ru.vtt"},
    }
    mock_subs.side_effect = lambda lang: f"https://example.com/subs_{lang}.vtt"
    mock.subtitles = mock_subs

    return mock


@pytest.fixture
def sample_content_info():
    """Create a sample ContentInfo for testing."""
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
def sample_stream_info():
    """Create a sample StreamInfo for testing."""
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


# Sample URLs for testing
VALID_MOVIE_URL = "https://hdrezka.ag/movies/action/12345-test-movie.html"
VALID_SERIES_URL = "https://hdrezka.ag/series/drama/54321-test-series.html"
INVALID_URL = "https://example.com/not-hdrezka.html"


@pytest.fixture
def test_urls():
    """Sample URLs for testing."""
    return {
        "valid_movie": VALID_MOVIE_URL,
        "valid_series": VALID_SERIES_URL,
        "invalid": INVALID_URL,
    }
