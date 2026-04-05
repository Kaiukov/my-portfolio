"""Live integration tests for representative HdRezka URLs."""

from __future__ import annotations

import pytest

from hdrezka.api import HdRezkaClient
from hdrezka.exceptions import ApiError

MOVIE_URL = "https://hdrezka-home.tv/films/drama/74844-formula-1-2025-latest.html"
SERIALS_URL = "https://hdrezka-home.tv/series/crime/1888-klan-soprano-1999-latest.html"
CARTOON_URL = "https://hdrezka-home.tv/cartoons/adventures/87949-odissey-1998.html"
ANIME_URL = "https://hdrezka-home.tv/animation/fantasy/85860-friren-provozhayuschaya-v-posledniy-put-tv-2-2026.html"
ANIME_MANY_URL = "https://hdrezka-home.tv/animation/comedy/2129-blich-tv-1-2004.html"


@pytest.mark.integration
@pytest.mark.parametrize(
    (
        "url",
        "expected_id",
        "expected_name",
        "expected_type",
        "expected_translator_count",
    ),
    [
        (MOVIE_URL, "74844", "F1", "movie", 12),
        (SERIALS_URL, "1888", "Клан Сопрано", "tv_series", 8),
        (CARTOON_URL, "87949", "Одиссей", "movie", 1),
        (ANIME_URL, "85860", "Фрирен, провожающая в последний путь [ТВ-2]", "tv_series", 8),
        (ANIME_MANY_URL, "2129", "Блич [ТВ-1]", "tv_series", 3),
    ],
)
def test_live_content_info(
    url: str,
    expected_id: str,
    expected_name: str,
    expected_type: str,
    expected_translator_count: int,
) -> None:
    """Live info lookup should return stable metadata for known URLs."""
    client = HdRezkaClient(url)
    info = client.get_content_info()

    assert info.id == expected_id
    assert info.name == expected_name
    assert info.type == expected_type
    assert len(info.translators) == expected_translator_count
    assert info.thumbnail is not None
    assert info.thumbnail.startswith("https://static.hdrezka.ac/i/")
    assert info.rating["value"] > 0


@pytest.mark.integration
@pytest.mark.parametrize(
    (
        "url",
        "expected_translator_id",
        "expected_season",
        "expected_episode",
        "expected_qualities",
    ),
    [
        (
            MOVIE_URL,
            "111",
            None,
            None,
            ["360p", "480p", "720p", "1080p"],
        ),
        (
            CARTOON_URL,
            "59",
            None,
            None,
            ["360p", "480p", "720p"],
        ),
        (
            SERIALS_URL,
            "12",
            1,
            1,
            ["360p", "480p", "720p", "1080p"],
        ),
        (
            ANIME_MANY_URL,
            "56",
            1,
            1,
            ["360p", "480p", "720p", "1080p"],
        ),
    ],
)
def test_live_stream_links(
    url: str,
    expected_translator_id: str,
    expected_season: int | None,
    expected_episode: int | None,
    expected_qualities: list[str],
) -> None:
    """Live stream lookup should return direct stream links without downloading."""
    client = HdRezkaClient(url)

    if expected_season is None:
        stream = client.get_stream()
    else:
        stream = client.get_stream(season=expected_season, episode=expected_episode)

    assert stream.url.startswith("https://stream.voidboost.cc/")
    assert stream.quality == "720p"
    assert stream.translator_id == expected_translator_id
    assert stream.season == expected_season
    assert stream.episode == expected_episode
    assert stream.available_qualities == expected_qualities
    assert stream.subtitles == {}


@pytest.mark.integration
def test_live_anime_without_series_data_reports_missing_season() -> None:
    """The 2026 anime title currently exposes metadata but no season map."""
    client = HdRezkaClient(ANIME_URL)

    with pytest.raises(ApiError, match='Season "1" is not found!'):
        client.get_stream(season=1, episode=1)
