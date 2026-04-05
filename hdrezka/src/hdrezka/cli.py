"""Command-line interface for hdrezka-cli."""

import sys

import click

from hdrezka import __version__
from hdrezka.config import Config
from hdrezka.exceptions import HdRezkaError
from hdrezka.runtime import create_client, create_formatter, format_error
from hdrezka.types import ContentType
from hdrezka.utils import parse_quality, validate_url


def _handle_error(config: Config, error: Exception) -> None:
    """Render an error and exit with a non-zero code."""
    if isinstance(error, HdRezkaError):
        message = str(error)
        details = error.details
    else:
        message = f"Unexpected error: {error}"
        details = None

    click.echo(format_error(config, message, details), err=True)
    sys.exit(1)


@click.group()
@click.version_option(version=__version__)
@click.option("-v", "--verbose", count=True, help="Increase verbosity")
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-error output")
@click.option("-j", "--json", "json_output", is_flag=True, help="Output JSON")
@click.option("-c", "--config", "config_path", type=click.Path(), help="Config file path")
@click.option("--proxy", help="Proxy URL for requests")
@click.option("--timeout", type=int, default=30, help="Request timeout")
@click.option("--no-color", is_flag=True, help="Disable colored output")
@click.pass_context
def cli(
    ctx: click.Context,
    verbose: int,
    quiet: bool,
    json_output: bool,
    config_path: str | None,
    proxy: str | None,
    timeout: int,
    no_color: bool,
) -> None:
    """HDRezka CLI - Comprehensive command-line interface for HdRezkaApi."""
    ctx.ensure_object(dict)

    try:
        config = Config(config_path) if config_path else Config()
    except Exception as error:
        click.echo(f"Config error: {error}", err=True)
        sys.exit(1)

    if proxy:
        config.set("network.proxy", proxy)
    if timeout:
        config.set("network.timeout", timeout)
    if json_output:
        config.set("output.json", True)
    if no_color:
        config.set("output.color", False)

    ctx.obj["config"] = config
    ctx.obj["verbose"] = verbose
    ctx.obj["quiet"] = quiet


@cli.command()
@click.argument("url")
@click.option("-t", "--type", "show_type", is_flag=True, help="Show content type only")
@click.option("-r", "--rating", is_flag=True, help="Show rating only")
@click.option("--translators", is_flag=True, help="Show available translators")
@click.option("--parts", is_flag=True, help="Show related content")
@click.option("--series", is_flag=True, help="Show series info (seasons/episodes)")
@click.option("--thumbnail", is_flag=True, help="Show thumbnail URL")
@click.option("--all", "show_all", is_flag=True, help="Show all available information")
@click.pass_context
def info(
    ctx: click.Context,
    url: str,
    show_type: bool,
    rating: bool,
    translators: bool,
    parts: bool,
    series: bool,
    thumbnail: bool,
    show_all: bool,
) -> None:
    """Show content information."""
    config = ctx.obj["config"]

    if not validate_url(url):
        click.echo(format_error(config, "Invalid URL format", {"url": url}), err=True)
        sys.exit(1)

    try:
        client = create_client(url, config)
        content_info = client.get_content_info()
        formatter = create_formatter(config)

        if show_type:
            output: str | ContentType = content_info.type
        elif rating:
            output = f"{content_info.rating['value']}/10 ({content_info.rating['votes']:,} votes)"
        elif show_all or any([translators, parts, series, thumbnail]):
            output = formatter.format_content_info(content_info)
        else:
            output = formatter.format_content_info(content_info)

        click.echo(output)
    except Exception as error:
        _handle_error(config, error)


@cli.command()
@click.argument("url")
@click.option("-q", "--quality", default="720p", help="Video quality (default: 720p)")
@click.option("-s", "--season", type=int, help="Season number (required for series)")
@click.option("-e", "--episode", type=int, help="Episode number (required for series)")
@click.option("-t", "--translation", "translator", help="Translator ID or name")
@click.option("-i", "--index", type=int, default=0, help="Translator index (default: 0)")
@click.option("--subtitles", is_flag=True, help="Include subtitle URLs")
@click.option("--all-qualities", is_flag=True, help="Show all available qualities")
@click.pass_context
def stream(
    ctx: click.Context,
    url: str,
    quality: str,
    season: int | None,
    episode: int | None,
    translator: str | None,
    index: int,
    subtitles: bool,
    all_qualities: bool,
) -> None:
    """Get stream URL for content."""
    config = ctx.obj["config"]

    if not validate_url(url):
        click.echo(format_error(config, "Invalid URL format", {"url": url}), err=True)
        sys.exit(1)

    try:
        parsed_quality = parse_quality(quality)
        client = create_client(url, config)
        stream_info = client.get_stream(
            quality=parsed_quality,
            season=season,
            episode=episode,
            translator=translator,
            index=index,
        )

        if not subtitles:
            stream_info.subtitles = {}

        formatter = create_formatter(config)
        if all_qualities and not config.json_output:
            output = formatter.format_stream_info(stream_info)
            if stream_info.available_qualities:
                output += f"\nAvailable qualities: {', '.join(stream_info.available_qualities)}"
        else:
            output = formatter.format_stream_info(stream_info)

        click.echo(output)
    except Exception as error:
        _handle_error(config, error)


@cli.command()
@click.argument("url")
@click.option("-s", "--season", type=int, required=True, help="Season number")
@click.option("-t", "--translation", "translator", help="Translator ID or name")
@click.option("-i", "--index", type=int, default=0, help="Translator index")
@click.option("--ignore-errors", is_flag=True, help="Continue on individual episode errors")
@click.option("--quality", default="720p", help="Video quality")
@click.option("-o", "--output", type=click.Path(), help="Save to JSON file")
@click.pass_context
def season(
    ctx: click.Context,
    url: str,
    season: int,
    translator: str | None,
    index: int,
    ignore_errors: bool,
    quality: str,
    output: str | None,
) -> None:
    """Get all episode streams for a season."""
    config = ctx.obj["config"]

    if not validate_url(url):
        click.echo(format_error(config, "Invalid URL format", {"url": url}), err=True)
        sys.exit(1)

    try:
        parsed_quality = parse_quality(quality)
        client = create_client(url, config)
        streams = client.get_season_streams(
            season=season,
            translator=translator,
            index=index,
            ignore_errors=ignore_errors,
            quality=parsed_quality,
        )

        formatter = create_formatter(
            config,
            "json" if config.json_output or output else "text",
        )
        output_text = formatter.format_season_streams(season, streams)

        if output:
            with open(output, "w", encoding="utf-8") as file:
                file.write(output_text)
            if not ctx.obj["quiet"]:
                click.echo(f"Saved to {output}")
        else:
            click.echo(output_text)
    except Exception as error:
        _handle_error(config, error)


def main() -> int:
    """Main entry point for the CLI."""
    cli()
    return 0


if __name__ == "__main__":
    sys.exit(main())
