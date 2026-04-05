"""Custom exceptions for hdrezka-cli."""

from typing import Any


class HdRezkaError(Exception):
    """Base exception for all hdrezka-cli errors.

    All custom exceptions inherit from this base class,
    allowing catching all hdrezka-cli errors with a single except clause.
    """

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        """Initialize exception with message and optional details.

        Args:
            message: Human-readable error message
            details: Additional error context (e.g., URL, status code)
        """
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def __str__(self) -> str:
        """Return formatted error message."""
        if self.details:
            details_str = ", ".join(f"{k}={v}" for k, v in self.details.items())
            return f"{self.message} ({details_str})"
        return self.message


class ConfigError(HdRezkaError):
    """Configuration related errors.

    Raised when:
    - Config file is malformed or missing
    - Invalid configuration values
    - Environment variable conflicts
    - Config file cannot be read/written
    """


class ApiError(HdRezkaError):
    """HdRezkaApi interaction errors.

    Raised when:
    - URL fetch fails
    - API returns unexpected data
    - Content type is invalid
    - Stream extraction fails
    """


class NetworkError(ApiError):
    """Network-related API errors.

    Raised when:
    - Connection timeout
    - DNS resolution failure
    - HTTP errors (4xx, 5xx)
    - Proxy connection failures
    """


class ValidationError(HdRezkaError):
    """Input validation errors.

    Raised when:
    - Invalid URL format
    - Invalid quality value
    - Invalid season/episode numbers
    - Missing required parameters
    """


class DownloadError(HdRezkaError):
    """Download related errors.

    Raised when:
    - Download fails partway through
    - File write permissions
    - Disk space insufficient
    - Remote download errors
    """


class TranslatorError(ApiError):
    """Translator selection errors.

    Raised when:
    - Translator ID not found
    - Translator name not found
    - No translators available
    """


class QualityError(ApiError):
    """Quality selection errors.

    Raised when:
    - Requested quality not available
    - Invalid quality format
    - No quality options available
    """
