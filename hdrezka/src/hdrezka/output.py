"""Output formatting for hdrezka-cli."""

import json
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from hdrezka.config import Config
from hdrezka.types import ContentInfo, OutputFormat, StreamInfo


class OutputFormatter:
    """Format output for CLI commands."""

    def __init__(
        self,
        output_format: str = "text",
        color: bool = True,
        config: Config | None = None,
    ) -> None:
        """Initialize output formatter.

        Args:
            output_format: Output format (json, text, table)
            color: Enable colored output
            config: Optional configuration object

        Raises:
            ValidationError: If output_format is invalid
        """
        # Validate output format
        valid_formats = ["json", "text", "table"]
        if output_format not in valid_formats:
            from hdrezka.exceptions import ValidationError
            raise ValidationError(
                f"Invalid output format: {output_format}",
                {"valid_formats": valid_formats}
            )
        self.output_format: OutputFormat = output_format  # type: ignore[assignment]
        self.color = color
        self.config = config
        self.console = Console() if color else Console(no_color=True)

    def format_content_info(self, info: ContentInfo) -> str:
        """Format content information.

        Args:
            info: ContentInfo object

        Returns:
            Formatted string
        """
        if self.output_format == "json":
            return self._format_json(info.to_dict())

        return self._format_content_text(info)

    def format_stream_info(self, stream: StreamInfo) -> str:
        """Format stream information.

        Args:
            stream: StreamInfo object

        Returns:
            Formatted string
        """
        if self.output_format == "json":
            return self._format_json(stream.to_dict())

        return self._format_stream_text(stream)

    def format_season_streams(
        self,
        season: int,
        streams: dict[int, StreamInfo],
    ) -> str:
        """Format season streams.

        Args:
            season: Season number
            streams: Dictionary of episode to StreamInfo

        Returns:
            Formatted string
        """
        data = {
            "season": season,
            "episodes": {
                str(ep): info.to_dict() for ep, info in streams.items()
            }
        }

        if self.output_format == "json":
            return self._format_json(data)

        return self._format_season_text(season, streams)

    def format_error(self, error: str, details: dict[str, Any] | None = None) -> str:
        """Format error message.

        Args:
            error: Error message
            details: Optional error details

        Returns:
            Formatted error string
        """
        if self.output_format == "json":
            return self._format_json({
                "success": False,
                "error": error,
                "details": details or {},
            })

        message = f"[red]Error:[/red] {error}"
        if details:
            details_str = ", ".join(f"{k}={v}" for k, v in details.items())
            message += f"\n       {details_str}"
        return message

    def format_success(self, message: str) -> str:
        """Format success message.

        Args:
            message: Success message

        Returns:
            Formatted string
        """
        if self.output_format == "json":
            return self._format_json({"success": True, "message": message})

        return f"[green]✓[/green] {message}"

    def _format_json(self, data: dict[str, Any]) -> str:
        """Format data as JSON.

        Args:
            data: Data to format

        Returns:
            JSON string
        """
        return json.dumps(data, indent=2, ensure_ascii=False)

    def _format_content_text(self, info: ContentInfo) -> str:
        """Format content info as human-readable text.

        Args:
            info: ContentInfo object

        Returns:
            Formatted text
        """
        lines = []

        # Header
        title = f"{info.name}"
        lines.append("=" * 60)
        lines.append(f"  {title}")
        lines.append("=" * 60)

        # Basic info
        lines.append(f"Type:     {self._format_type(info.type)}")
        lines.append(f"ID:       {info.id}")

        # Rating
        if info.rating and info.rating.get("votes", 0) > 0:
            rating = info.rating.get("value", 0)
            votes = info.rating.get("votes", 0)
            stars = self._rating_stars(rating)
            lines.append(f"Rating:   {stars} {rating}/10 ({votes:,} votes)")

        # Thumbnail
        if info.thumbnail:
            lines.append(f"Thumbnail: {info.thumbnail}")

        # Translators
        if info.translators:
            lines.append(f"Translators: {len(info.translators)} available")
            for i, t in enumerate(info.translators[:5], 1):
                default = " (default)" if i == 1 else ""
                lines.append(f"  {i}. {t.get('name', f'Translator {i}')}{default}")
            if len(info.translators) > 5:
                lines.append(f"  ... and {len(info.translators) - 5} more")

        # Series info
        if info.series_info:
            lines.append("\nSeasons:")
            for s in info.series_info:
                lines.append(f"  Season {s['season']}: {s['episodes']} episodes")

        # Other parts
        if info.other_parts:
            lines.append(f"\nRelated: {len(info.other_parts)} titles")
            for part in info.other_parts[:3]:
                lines.append(f"  - {part.get('name', 'Unknown')}")

        lines.append("=" * 60)

        return "\n".join(lines)

    def _format_stream_text(self, stream: StreamInfo) -> str:
        """Format stream info as human-readable text.

        Args:
            stream: StreamInfo object

        Returns:
            Formatted text
        """
        lines = []

        # Stream URL
        lines.append(f"Stream URL: {stream.url}")

        # Quality
        lines.append(f"Quality:    {stream.quality}")
        if stream.available_qualities:
            lines.append(f"Available:  {', '.join(stream.available_qualities)}")

        # Translator
        if stream.translator_name:
            lines.append(f"Translator: {stream.translator_name}")

        # Season/Episode
        if stream.season and stream.episode:
            lines.append(f"Episode:    S{stream.season:02d}E{stream.episode:02d}")

        # Subtitles
        if stream.subtitles:
            langs = ", ".join(stream.subtitles.keys())
            lines.append(f"Subtitles:  {langs}")

        return "\n".join(lines)

    def _format_season_text(
        self,
        season: int,
        streams: dict[int, StreamInfo],
    ) -> str:
        """Format season streams as human-readable text.

        Args:
            season: Season number
            streams: Dictionary of episode to StreamInfo

        Returns:
            Formatted text
        """
        lines = []
        lines.append(f"Season {season} Streams")
        lines.append("=" * 60)

        for episode, stream in sorted(streams.items()):
            lines.append(f"\nEpisode {episode}:")
            lines.append(f"  URL:     {stream.url}")
            lines.append(f"  Quality: {stream.quality}")

        return "\n".join(lines)

    def _format_type(self, content_type: str) -> str:
        """Format content type for display.

        Args:
            content_type: Content type string

        Returns:
            Formatted type name
        """
        type_names = {
            "movie": "Movie",
            "tv_series": "TV Series",
            "tv_show": "TV Show",
            "cartoon": "Cartoon",
            "cartoon_series": "Cartoon Series",
        }
        return type_names.get(content_type, content_type.title())

    def _rating_stars(self, rating: float) -> str:
        """Convert rating to star representation.

        Args:
            rating: Rating value (0-10)

        Returns:
            Star string
        """
        normalized = rating / 2  # Convert to 0-5 scale
        full_stars = int(normalized)
        half_star = 1 if (normalized - full_stars) >= 0.5 else 0
        empty_stars = 5 - full_stars - half_star

        return "★" * full_stars + "½" * half_star + "☆" * empty_stars

    def print(self, text: str) -> None:
        """Print text to console.

        Args:
            text: Text to print
        """
        self.console.print(text)

    def print_table(
        self,
        title: str,
        columns: list[str],
        rows: list[list[str]],
    ) -> None:
        """Print data as a table.

        Args:
            title: Table title
            columns: Column headers
            rows: Table rows
        """
        table = Table(title=title, show_header=True, header_style="bold magenta")
        for column in columns:
            table.add_column(column)

        for row in rows:
            table.add_row(*row)

        self.console.print(table)

    def print_panel(self, content: str, title: str = "") -> None:
        """Print content in a panel.

        Args:
            content: Panel content
            title: Optional panel title
        """
        self.console.print(Panel(content, title=title))


def get_formatter(
    output_format: OutputFormat = "text",
    color: bool = True,
    config: Config | None = None,
) -> OutputFormatter:
    """Get an OutputFormatter instance.

    Args:
        output_format: Output format (json, text, table)
        color: Enable colored output
        config: Optional configuration object

    Returns:
        OutputFormatter instance
    """
    return OutputFormatter(output_format, color, config)
