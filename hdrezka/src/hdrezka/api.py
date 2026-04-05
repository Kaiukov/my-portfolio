"""HdRezkaApi wrapper with error handling and retry logic."""

from typing import Any, cast

from HdRezkaApi import HdRezkaApi, Movie, TVSeries

from hdrezka.config import Config
from hdrezka.exceptions import (
    ApiError,
    NetworkError,
    QualityError,
    TranslatorError,
    ValidationError,
)
from hdrezka.types import (
    ContentInfo,
    ContentType,
    EpisodeNumber,
    Quality,
    SeasonNumber,
    StreamInfo,
    TranslatorId,
    TranslatorName,
)


class HdRezkaClient:
    """Wrapper for HdRezkaApi with enhanced error handling."""

    def __init__(
        self,
        url: str,
        proxy: dict[str, str] | None = None,
        timeout: int = 30,
        config: Config | None = None,
    ) -> None:
        """Initialize HdRezkaApi client.

        Args:
            url: HdRezka content URL
            proxy: Optional proxy configuration {'http': 'http://proxy:port'}
            timeout: Request timeout in seconds
            config: Optional configuration object

        Raises:
            ValidationError: If URL is invalid
            NetworkError: If connection fails
        """
        self._validate_url(url)
        self.url = url
        self.config = config
        self._timeout = timeout

        try:
            self._api = HdRezkaApi(url, proxy=proxy)
        except Exception as e:
            raise NetworkError(
                f"Failed to initialize HdRezkaApi for URL: {url}",
                {"error": str(e)}
            ) from e

    def _validate_url(self, url: str) -> None:
        """Validate URL format.

        Args:
            url: URL to validate

        Raises:
            ValidationError: If URL format is invalid
        """
        if not url or not isinstance(url, str):
            raise ValidationError(
                "URL must be a non-empty string",
                {"provided": type(url).__name__}
            )

        if not url.startswith(("http://", "https://")):
            raise ValidationError(
                "URL must start with http:// or https://",
                {"provided": url}
            )

        # Basic domain check (allowing various hdrezka mirrors)
        valid_domains = [
            "hdrezka",
            "hdrezka.ag",
            "hdrezka.ink",
            "hdrezka.tv",
            "hdrezka.one",
        ]
        if not any(domain in url.lower() for domain in valid_domains):
            raise ValidationError(
                "URL does not appear to be a valid HdRezka URL",
                {"provided": url}
            )

    @property
    def id(self) -> str:
        """Get content ID."""
        return str(getattr(self._api, "id", ""))

    @property
    def name(self) -> str:
        """Get content name."""
        return str(getattr(self._api, "name", ""))

    @property
    def type(self) -> ContentType:
        """Get content type."""
        api_type = getattr(self._api, "type", None)

        if api_type == TVSeries:
            return "tv_series"
        elif api_type == Movie:
            return "movie"
        elif isinstance(api_type, str):
            # Map string types
            type_mapping: dict[str, ContentType] = {
                "tv_series": "tv_series",
                "tv_show": "tv_show",
                "cartoon_series": "cartoon_series",
                "cartoon": "cartoon",
                "movie": "movie",
            }
            return type_mapping.get(api_type.lower(), "movie")

        return "movie"  # Default to movie

    @property
    def thumbnail(self) -> str | None:
        """Get thumbnail URL."""
        return getattr(self._api, "thumbnail", None)

    @property
    def rating(self) -> dict[str, Any]:
        """Get rating information."""
        rating_obj = getattr(self._api, "rating", None)
        if rating_obj:
            return {
                "value": float(getattr(rating_obj, "value", 0.0)),
                "votes": int(getattr(rating_obj, "votes", 0)),
            }
        return {"value": 0.0, "votes": 0}

    @property
    def translators(self) -> list[dict[str, Any]]:
        """Get list of available translators."""
        translators_list = getattr(self._api, "translators", [])
        result = []

        for i, t in enumerate(translators_list):
            if isinstance(t, dict):
                result.append({
                    "id": str(t.get("id", i)),
                    "name": str(t.get("name", f"Translator {i}")),
                    "index": i,
                })
            else:
                result.append({
                    "id": str(i),
                    "name": str(t),
                    "index": i,
                })

        return result

    @property
    def series_info(self) -> list[dict[str, Any]]:
        """Get series information (seasons and episodes)."""
        if self.type != "tv_series":
            return []

        series_info = getattr(self._api, "seriesInfo", [])
        result = []

        for season in series_info:
            if isinstance(season, dict):
                result.append({
                    "season": int(season.get("season", 0)),
                    "episodes": int(season.get("episodes", 0)),
                })
            elif isinstance(season, (list, tuple)) and len(season) >= 2:
                result.append({
                    "season": int(season[0]),
                    "episodes": int(season[1]),
                })

        return result

    @property
    def other_parts(self) -> list[dict[str, Any]]:
        """Get related content."""
        parts = getattr(self._api, "otherParts", [])
        result = []

        for part in parts:
            if isinstance(part, dict):
                result.append({
                    "id": str(part.get("id", "")),
                    "name": str(part.get("name", "")),
                    "url": str(part.get("url", "")),
                })

        return result

    def get_content_info(self) -> ContentInfo:
        """Get complete content information.

        Returns:
            ContentInfo object with all available metadata

        Raises:
            ApiError: If information cannot be retrieved
        """
        try:
            return ContentInfo(
                id=self.id,
                name=self.name,
                type=self.type,
                rating=self.rating,
                translators=self.translators,
                thumbnail=self.thumbnail,
                other_parts=self.other_parts,
                series_info=self.series_info,
            )
        except Exception as e:
            raise ApiError(
                f"Failed to get content info for {self.url}",
                {"error": str(e)}
            ) from e

    def get_stream(
        self,
        quality: Quality = "720p",
        season: SeasonNumber | None = None,
        episode: EpisodeNumber | None = None,
        translator: TranslatorId | TranslatorName | None = None,
        index: int = 0,
    ) -> StreamInfo:
        """Get stream URL for content.

        Args:
            quality: Video quality (360p, 480p, 720p, 1080p, 2160p, Ultra)
            season: Season number (required for TV series)
            episode: Episode number (required for TV series)
            translator: Translator ID or name
            index: Translator index fallback

        Returns:
            StreamInfo object with stream URL and metadata

        Raises:
            ValidationError: If parameters are invalid for content type
            ApiError: If stream cannot be retrieved
            QualityError: If requested quality is not available
            TranslatorError: If translator is not found
        """
        # Validate season/episode for series
        if self.type == "tv_series":
            if season is None or episode is None:
                raise ValidationError(
                    "Season and episode are required for TV series",
                    {"type": self.type, "season": season, "episode": episode}
                )
        else:
            if season is not None or episode is not None:
                raise ValidationError(
                    "Season/episode only valid for TV series",
                    {"type": self.type}
                )

        # Resolve translator
        translator_id = self._resolve_translator(translator, index)

        # Get stream from API
        try:
            stream = self._api.getStream(
                season=season,
                episode=episode,
                translation=translator_id,
            )
        except Exception as e:
            raise ApiError(
                f"Failed to get stream for {self.url}",
                {
                    "error": str(e),
                    "season": season,
                    "episode": episode,
                    "translator": translator_id,
                }
            ) from e

        if stream is None:
            raise ApiError(
                "No stream returned from API",
                {"season": season, "episode": episode}
            )

        # Get video URL for requested quality
        video_url = self._get_quality_url(stream, quality)

        # Get subtitles
        subtitles = self._get_subtitles(stream)

        # Get available qualities
        available_qualities = self._get_available_qualities(stream)

        # Get translator info
        translator_name = self._get_translator_name(translator_id)

        return StreamInfo(
            url=video_url,
            quality=quality,
            translator_id=str(translator_id) if translator_id else None,
            translator_name=translator_name,
            season=season,
            episode=episode,
            subtitles=subtitles,
            available_qualities=available_qualities,
        )

    def _resolve_translator(
        self,
        translator: TranslatorId | TranslatorName | None,
        index: int,
    ) -> str | None:
        """Resolve translator from ID, name, or index.

        Args:
            translator: Translator ID, name, or None
            index: Fallback translator index

        Returns:
            Resolved translator ID or None

        Raises:
            TranslatorError: If translator cannot be resolved
        """
        raw_translators = getattr(self._api, "translators", {})
        translator_items: list[tuple[str, str]] = []

        if isinstance(raw_translators, dict):
            translator_items = [
                (str(translator_id), str(data.get("name", translator_id)))
                for translator_id, data in raw_translators.items()
                if isinstance(data, dict)
            ]
        elif isinstance(raw_translators, list):
            for item in raw_translators:
                if isinstance(item, dict):
                    translator_items.append(
                        (str(item.get("id", len(translator_items))), str(item.get("name", "")))
                    )

        # If translator is None, use index fallback
        if translator is None:
            if 0 <= index < len(translator_items):
                return translator_items[index][0]
            return None

        # If it's already an ID (int), convert to string
        if isinstance(translator, int):
            return str(translator)

        # If it's a string, check if it's a name or ID
        for translator_id, translator_name in translator_items:
            if translator_name.lower() == translator.lower():
                return translator_id
            if translator_id == translator:
                return translator_id

        raise TranslatorError(
            f"Translator not found: {translator}",
            {"available": [name for _, name in translator_items]}
        )

    def _get_translator_name(self, translator_id: str | None) -> str | None:
        """Get translator name from ID.

        Args:
            translator_id: Translator ID

        Returns:
            Translator name or None
        """
        if not translator_id:
            return None

        for t in self.translators:
            if t["id"] == translator_id:
                return cast(str, t["name"])

        return None

    def _get_quality_url(self, stream: Any, quality: Quality) -> str:
        """Get video URL for specific quality.

        Args:
            stream: HdRezkaStream object
            quality: Requested quality

        Returns:
            Direct video URL

        Raises:
            QualityError: If quality is not available
        """
        def normalize_url(value: Any) -> str | None:
            """Normalize a stream return value into a direct URL."""
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
            if isinstance(value, (list, tuple)):
                for item in value:
                    if isinstance(item, str) and item.startswith(("http://", "https://")):
                        return item
            return None

        try:
            # Try calling stream with quality
            url = normalize_url(stream(quality))
            if url:
                return url
        except Exception:
            pass

        # Try without 'p' suffix
        quality_alt = quality.rstrip("p")
        try:
            url = normalize_url(stream(quality_alt))
            if url:
                return url
        except Exception:
            pass

        videos = getattr(stream, "videos", {})
        if isinstance(videos, dict):
            candidates = [quality, quality_alt, quality.upper(), quality_alt.upper()]
            for key in candidates:
                value = videos.get(key)
                url = normalize_url(value)
                if url:
                    return url

        # Check available qualities
        available = self._get_available_qualities(stream)
        raise QualityError(
            f"Quality not available: {quality}",
            {"requested": quality, "available": available}
        )

    def _get_available_qualities(self, stream: Any) -> list[Quality]:
        """Get list of available qualities.

        Args:
            stream: HdRezkaStream object

        Returns:
            List of available quality strings
        """
        qualities: list[Quality] = []
        videos = getattr(stream, "videos", {})

        valid_qualities: list[Quality] = ["360p", "480p", "720p", "1080p", "2160p", "Ultra"]

        for key in videos:
            if isinstance(key, str):
                # Normalize quality format
                quality = key.upper()
                if not quality.endswith("P") and quality.isdigit():
                    quality = f"{quality}p"
                quality_lower = quality.lower()
                # Only add if it's a valid quality
                if quality_lower in valid_qualities:
                    qualities.append(quality_lower)

        return qualities

    def _get_subtitles(self, stream: Any) -> dict[str, str]:
        """Get subtitle URLs by language.

        Args:
            stream: HdRezkaStream object

        Returns:
            Dictionary of language codes to subtitle URLs
        """
        subtitles = {}
        subs_obj = getattr(stream, "subtitles", None)

        if subs_obj:
            # Try to get subtitle keys
            keys = getattr(subs_obj, "keys", [])
            subs_dict = getattr(subs_obj, "subtitles", {})

            for key in keys:
                if isinstance(key, str):
                    # Try to get URL by language code
                    try:
                        url = subs_obj(key)
                        if url and isinstance(url, str):
                            subtitles[key.lower()] = url
                    except Exception:
                        pass

            # Also check subtitles dict directly
            if not subtitles and subs_dict:
                for lang, info in subs_dict.items():
                    if isinstance(info, dict):
                        url = info.get("link") or info.get("url")
                        if url:
                            subtitles[lang.lower()] = url

        return subtitles

    def get_season_streams(
        self,
        season: SeasonNumber,
        translator: TranslatorId | TranslatorName | None = None,
        index: int = 0,
        ignore_errors: bool = False,
        quality: Quality = "720p",
    ) -> dict[int, StreamInfo]:
        """Get all episode streams for a season.

        Args:
            season: Season number
            translator: Translator ID or name
            index: Translator index fallback
            ignore_errors: Continue on individual episode errors
            quality: Video quality for all episodes

        Returns:
            Dictionary mapping episode numbers to StreamInfo

        Raises:
            ValidationError: If content is not a TV series
            ApiError: If season cannot be retrieved
        """
        if self.type != "tv_series":
            raise ValidationError(
                "Season streams only available for TV series",
                {"type": self.type}
            )

        # Get series info to find episode count
        series_info = self.series_info
        season_data = next((s for s in series_info if s["season"] == season), None)

        if not season_data:
            raise ApiError(
                f"Season not found: {season}",
                {"available": [s["season"] for s in series_info]}
            )

        episode_count = season_data["episodes"]
        result = {}

        for episode in range(1, episode_count + 1):
            try:
                stream_info = self.get_stream(
                    quality=quality,
                    season=season,
                    episode=episode,
                    translator=translator,
                    index=index,
                )
                result[episode] = stream_info
            except Exception as e:
                if not ignore_errors:
                    raise ApiError(
                        f"Failed to get stream for S{season:02d}E{episode:02d}",
                        {"error": str(e)}
                    ) from e
                # Continue on error if ignore_errors is True

        return result


def get_client(
    url: str,
    proxy: dict[str, str] | None = None,
    timeout: int = 30,
    config: Config | None = None,
) -> HdRezkaClient:
    """Create a HdRezkaClient instance.

    Args:
        url: HdRezka content URL
        proxy: Optional proxy configuration
        timeout: Request timeout in seconds
        config: Optional configuration object

    Returns:
        HdRezkaClient instance

    Raises:
        ValidationError: If URL is invalid
        NetworkError: If connection fails
    """
    return HdRezkaClient(url, proxy, timeout, config)
