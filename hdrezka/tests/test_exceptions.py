"""Tests for custom exceptions."""


from hdrezka.exceptions import (
    ApiError,
    ConfigError,
    DownloadError,
    HdRezkaError,
    NetworkError,
    QualityError,
    TranslatorError,
    ValidationError,
)


class TestHdRezkaError:
    """Tests for base HdRezkaError exception."""

    def test_basic_error(self):
        error = HdRezkaError("Test error")
        assert str(error) == "Test error"
        assert error.message == "Test error"
        assert error.details == {}

    def test_error_with_details(self):
        error = HdRezkaError("Test error", {"key": "value"})
        assert str(error) == "Test error (key=value)"
        assert error.details == {"key": "value"}


class TestValidationError:
    """Tests for ValidationError exception."""

    def test_validation_error(self):
        error = ValidationError("Invalid URL")
        assert isinstance(error, HdRezkaError)
        assert "Invalid URL" in str(error)


class TestApiError:
    """Tests for ApiError exception."""

    def test_api_error(self):
        error = ApiError("API call failed", {"code": 500})
        assert isinstance(error, HdRezkaError)
        assert "code=500" in str(error)


class TestNetworkError:
    """Tests for NetworkError exception."""

    def test_network_error(self):
        error = NetworkError("Connection timeout")
        assert isinstance(error, ApiError)
        assert isinstance(error, HdRezkaError)


class TestQualityError:
    """Tests for QualityError exception."""

    def test_quality_error(self):
        error = QualityError("Quality not available", {"requested": "4K"})
        assert isinstance(error, ApiError)


class TestTranslatorError:
    """Tests for TranslatorError exception."""

    def test_translator_error(self):
        error = TranslatorError("Translator not found")
        assert isinstance(error, ApiError)


class TestConfigError:
    """Tests for ConfigError exception."""

    def test_config_error(self):
        error = ConfigError("Config file not found")
        assert isinstance(error, HdRezkaError)


class TestDownloadError:
    """Tests for DownloadError exception."""

    def test_download_error(self):
        error = DownloadError("Download failed")
        assert isinstance(error, HdRezkaError)


class TestExceptionHierarchy:
    """Tests for exception hierarchy."""

    def test_all_inherit_from_base(self):
        assert issubclass(ValidationError, HdRezkaError)
        assert issubclass(ApiError, HdRezkaError)
        assert issubclass(NetworkError, ApiError)
        assert issubclass(QualityError, ApiError)
        assert issubclass(TranslatorError, ApiError)
        assert issubclass(ConfigError, HdRezkaError)
        assert issubclass(DownloadError, HdRezkaError)

    def test_catch_base_exception(self):
        errors = [
            ValidationError("test"),
            ApiError("test"),
            ConfigError("test"),
            DownloadError("test"),
        ]

        for error in errors:
            try:
                raise error
            except HdRezkaError:
                pass  # Should catch all
