"""Type definitions for hdrezka-cli."""

from typing import Any, Literal

# Quality types
type Quality = Literal["360p", "480p", "720p", "1080p", "2160p", "Ultra"]

# URL types
type HdRezkaUrl = str

# Translator types
type TranslatorId = str | int
type TranslatorName = str

# Content types
type ContentType = Literal["movie", "tv_series", "tv_show", "cartoon", "cartoon_series"]

# Output formats
type OutputFormat = Literal["json", "text", "table"]

# Config file paths
type ConfigPath = str

# Season/Episode numbers
type SeasonNumber = int
type EpisodeNumber = int

# Stream metadata
class StreamInfo:
    """Stream information container."""

    def __init__(
        self,
        url: str,
        quality: Quality,
        translator_id: str | None = None,
        translator_name: str | None = None,
        season: SeasonNumber | None = None,
        episode: EpisodeNumber | None = None,
        subtitles: dict[str, str] | None = None,
        available_qualities: list[Quality] | None = None,
    ) -> None:
        """Initialize stream information.

        Args:
            url: Direct video stream URL
            quality: Selected video quality
            translator_id: Translator ID used
            translator_name: Translator name used
            season: Season number (for series)
            episode: Episode number (for series)
            subtitles: Dictionary of subtitle language codes to URLs
            available_qualities: List of available quality options
        """
        self.url = url
        self.quality = quality
        self.translator_id = translator_id
        self.translator_name = translator_name
        self.season = season
        self.episode = episode
        self.subtitles = subtitles or {}
        self.available_qualities = available_qualities or []

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization.

        Returns:
            Dictionary representation of stream info
        """
        return {
            "video_url": self.url,
            "quality": self.quality,
            "translator": {
                "id": self.translator_id,
                "name": self.translator_name,
            } if self.translator_id else None,
            "season": self.season,
            "episode": self.episode,
            "subtitles": self.subtitles,
            "available_qualities": self.available_qualities,
        }


class ContentInfo:
    """Content information container."""

    def __init__(
        self,
        id: str,
        name: str,
        type: ContentType,
        rating: dict[str, Any] | None = None,
        translators: list[dict[str, Any]] | None = None,
        thumbnail: str | None = None,
        other_parts: list[dict[str, Any]] | None = None,
        series_info: list[dict[str, Any]] | None = None,
    ) -> None:
        """Initialize content information.

        Args:
            id: Content ID
            name: Content title
            type: Content type (movie, series, etc.)
            rating: Rating information (value, votes)
            translators: List of available translators
            thumbnail: Thumbnail URL
            other_parts: List of related content
            series_info: Seasons and episodes for TV series
        """
        self.id = id
        self.name = name
        self.type = type
        self.rating = rating or {}
        self.translators = translators or []
        self.thumbnail = thumbnail
        self.other_parts = other_parts or []
        self.series_info = series_info or []

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization.

        Returns:
            Dictionary representation of content info
        """
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "rating": self.rating,
            "translators": self.translators,
            "thumbnail": self.thumbnail,
            "other_parts": self.other_parts,
            "series_info": self.series_info,
        }


# Default values
DEFAULT_QUALITY: Quality = "720p"
DEFAULT_TIMEOUT: int = 30
DEFAULT_RETRY_COUNT: int = 3
DEFAULT_RETRY_DELAY: float = 1.0

# Quality options ordered by preference
QUALITY_PREFERENCE: list[Quality] = [
    "2160p", "1080p", "720p", "480p", "360p", "Ultra"
]
