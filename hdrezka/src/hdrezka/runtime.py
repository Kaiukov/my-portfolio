"""Shared runtime helpers for the hdrezka CLI."""

from typing import Any

from hdrezka.api import HdRezkaClient
from hdrezka.config import Config
from hdrezka.output import OutputFormatter
from hdrezka.types import OutputFormat


def create_formatter(
    config: Config,
    output_format: OutputFormat | None = None,
) -> OutputFormatter:
    """Create an output formatter from CLI config."""
    format_name: OutputFormat = output_format or ("json" if config.json_output else "text")
    return OutputFormatter(format_name, config.color_output, config)


def create_client(url: str, config: Config) -> HdRezkaClient:
    """Create an API client from CLI config."""
    proxy_dict = {"http": config.proxy} if config.proxy else None
    return HdRezkaClient(url, proxy=proxy_dict, timeout=config.timeout, config=config)


def format_error(
    config: Config,
    error: str,
    details: dict[str, Any] | None = None,
) -> str:
    """Format an error message for CLI output."""
    return create_formatter(config).format_error(error, details)
