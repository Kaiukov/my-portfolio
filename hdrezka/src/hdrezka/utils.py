"""Utility functions for hdrezka-cli."""

import re
from typing import Any, cast

from hdrezka.exceptions import ValidationError
from hdrezka.types import Quality

# Type alias for translator dict (can have various value types)
TranslatorDict = dict[str, Any]  # Keys: "id", "name", "index"


def parse_quality(quality: str | int | None) -> Quality:
    """Parse and normalize quality value.

    Args:
        quality: Quality value (e.g., "720p", 720, "1080", "Ultra")

    Returns:
        Normalized quality string

    Raises:
        ValidationError: If quality format is invalid
    """
    if quality is None:
        return "720p"

    # Convert to string
    quality_str = str(quality).strip().upper()

    # Handle special qualities
    if quality_str in ("ULTRA", "2160P"):
        return "Ultra" if quality_str == "ULTRA" else "2160p"

    # Extract number from quality string
    match = re.match(r"(\d+)\s*P?", quality_str)
    if not match:
        raise ValidationError(
            f"Invalid quality format: {quality}",
            {"valid_formats": ["360p", "480p", "720p", "1080p", "2160p", "Ultra"]}
        )

    number = int(match.group(1))

    # Map to valid quality
    quality_map = {
        360: "360p",
        480: "480p",
        720: "720p",
        1080: "1080p",
        2160: "2160p",
    }

    if number not in quality_map:
        raise ValidationError(
            f"Unsupported quality: {quality}",
            {"supported": list(quality_map.values())}
        )

    return cast(Quality, quality_map[number])


def parse_translator(
    translator: str | int | None,
    translators: list[TranslatorDict],
) -> str | int | None:
    """Parse translator identifier.

    Args:
        translator: Translator ID, name, or index
        translators: List of available translators

    Returns:
        Parsed translator identifier

    Raises:
        ValidationError: If translator cannot be resolved
    """
    if translator is None:
        return None

    # If it's an int, return as is
    if isinstance(translator, int):
        if translator < 0 or translator >= len(translators):
            raise ValidationError(
                f"Translator index out of range: {translator}",
                {"available": len(translators)}
            )
        return translator

    # If it's a string, check if it's a name or numeric ID
    translator_str = str(translator).strip()

    # Check for numeric string
    if translator_str.isdigit():
        index = int(translator_str)
        if index < len(translators):
            translator_id = translators[index]["id"]
            if isinstance(translator_id, str):
                return translator_id

    # Search by name or ID
    for t in translators:
        if t["name"].lower() == translator_str.lower():
            tid = t["id"]
            if isinstance(tid, str):
                return tid
        if t["id"] == translator_str:
            tid = t["id"]
            if isinstance(tid, str):
                return tid

    # Not found
    raise ValidationError(
        f"Translator not found: {translator}",
        {"available": [t["name"] for t in translators]}
    )


def format_file_name(
    name: str,
    season: int | None = None,
    episode: int | None = None,
    extension: str = "mp4",
) -> str:
    """Format filename for download.

    Args:
        name: Content name
        season: Optional season number
        episode: Optional episode number
        extension: File extension

    Returns:
        Formatted filename
    """
    # Clean name: remove invalid characters
    clean_name = re.sub(r'[<>:"/\\|?*]', "", name)
    clean_name = clean_name.strip()

    # Add season/episode if present
    if season is not None and episode is not None:
        return f"{clean_name}.S{season:02d}E{episode:02d}.{extension}"
    elif season is not None:
        return f"{clean_name}.S{season:02d}.{extension}"

    return f"{clean_name}.{extension}"


def format_bytes(size: int) -> str:
    """Format bytes to human-readable string.

    Args:
        size: Size in bytes

    Returns:
        Formatted string (e.g., "1.5 GB")
    """
    float_size: float = float(size)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if float_size < 1024.0:
            return f"{float_size:.1f} {unit}"
        float_size /= 1024.0
    return f"{float_size:.1f} PB"


def extract_season_episode(url: str) -> tuple[int | None, int | None]:
    """Extract season and episode from URL if present.

    Args:
        url: HdRezka URL

    Returns:
        Tuple of (season, episode) or (None, None)
    """
    season = None
    episode = None

    # Try to extract from URL patterns
    # Pattern: /season-X-episode-Y/ or /sXeY/
    patterns = [
        r"/season-(\d+)-episode-(\d+)",
        r"/s(\d+)e(\d+)",
        r"/season[/-](\d+).+episode[/-](\d+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, url.lower())
        if match:
            season = int(match.group(1))
            episode = int(match.group(2))
            break

    return season, episode


def validate_url(url: str) -> bool:
    """Validate if URL appears to be a valid HdRezka URL.

    Args:
        url: URL to validate

    Returns:
        True if valid, False otherwise
    """
    if not url or not isinstance(url, str):
        return False

    if not url.startswith(("http://", "https://")):
        return False

    valid_domains = [
        "hdrezka",
        "hdrezka.ag",
        "hdrezka.ink",
        "hdrezka.tv",
        "hdrezka.one",
    ]

    return any(domain in url.lower() for domain in valid_domains)
