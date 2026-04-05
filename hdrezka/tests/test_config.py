"""Tests for configuration management."""

import tempfile
from pathlib import Path

import pytest

from hdrezka.config import Config
from hdrezka.exceptions import ConfigError


class TestConfig:
    """Tests for Config class."""

    def test_default_config(self):
        """Test that default config values are set correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "nonexistent.toml"
            config = Config(config_path)

            assert config.quality == "720p"
            assert config.translator_index == 0
            assert config.timeout == 30
            assert config.retry_count == 3
            assert config.json_output is False
            assert config.color_output is True

    def test_config_from_file(self, sample_config):
        """Test loading config from file."""
        assert sample_config.quality == "720p"
        assert sample_config.translator_index == 0

    def test_config_get_nested(self, sample_config):
        """Test getting nested config values."""
        assert sample_config.get("default.quality") == "720p"
        assert sample_config.get("network.timeout") == 30
        assert sample_config.get("nonexistent.key", "default") == "default"

    def test_config_set_nested(self, sample_config):
        """Test setting nested config values."""
        sample_config.set("default.quality", "1080p")
        assert sample_config.get("default.quality") == "1080p"

    def test_output_directory_expansion(self, sample_config):
        """Test that output directory is expanded from ~."""
        output_dir = sample_config.output_directory
        assert str(output_dir).startswith("/")
        assert "~" not in str(output_dir)

    def test_config_save(self, tmp_path):
        """Test saving config to file."""
        config_file = tmp_path / "test_config.toml"
        config = Config(config_file)
        config.set("default.quality", "1080p")
        config.save()

        # Load again and verify
        config2 = Config(config_file)
        assert config2.get("default.quality") == "1080p"

    def test_config_reset(self, sample_config):
        """Test resetting config to defaults."""
        sample_config.set("default.quality", "1080p")
        sample_config.reset()
        assert sample_config.quality == "720p"

    def test_env_var_override(self, tmp_path, monkeypatch):
        """Test environment variable overrides."""
        monkeypatch.setenv("HDREZKA_DEFAULT_QUALITY", "1080p")
        monkeypatch.setenv("HDREZKA_TIMEOUT", "60")

        config = Config(tmp_path / "config.toml")
        assert config.quality == "1080p"
        assert config.timeout == 60

    def test_invalid_env_var(self, tmp_path, monkeypatch):
        """Test invalid environment variable value."""
        monkeypatch.setenv("HDREZKA_TIMEOUT", "not-a-number")

        with pytest.raises(ConfigError):
            Config(tmp_path / "config.toml")

    def test_malformed_config_file(self, tmp_path):
        """Test loading malformed config file."""
        config_file = tmp_path / "bad.toml"
        config_file.write_text("invalid [toml content")

        with pytest.raises(ConfigError):
            Config(config_file)
