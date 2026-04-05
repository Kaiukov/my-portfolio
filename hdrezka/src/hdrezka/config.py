"""Configuration management for hdrezka-cli."""

import os
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any, cast

import toml

from hdrezka.exceptions import ConfigError
from hdrezka.types import Quality

# Default configuration values
DEFAULT_CONFIG: dict[str, dict[str, Any]] = {
    "default": {
        "quality": "720p",
        "translator_index": 0,
        "output_directory": "~/Downloads",
        "ssh_user": "",
    },
    "download": {
        "threads": 1,
        "continue": True,
        "timeout": 300,
        "subtitles": False,
        "subtitles_lang": "en",
    },
    "output": {
        "json": False,
        "color": True,
        "progress": True,
    },
    "network": {
        "proxy": None,
        "timeout": 30,
        "retry": 3,
        "retry_delay": 1.0,
    },
}

# Environment variable mappings
ENV_MAPPINGS: dict[str, tuple[str, type | Callable[[Any], Any]]] = {
    "HDREZKA_CONFIG": ("config_path", str),
    "HDREZKA_DEFAULT_QUALITY": ("default.quality", str),
    "HDREZKA_TRANSLATOR_INDEX": ("default.translator_index", int),
    "HDREZKA_OUTPUT_DIR": ("default.output_directory", str),
    "HDREZKA_SSH_HOST": ("ssh.host", str),
    "HDREZKA_SSH_PATH": ("ssh.path", str),
    "HDREZKA_SSH_USER": ("ssh.user", str),
    "HDREZKA_PROXY": ("network.proxy", str),
    "HDREZKA_TIMEOUT": ("network.timeout", int),
    "HDREZKA_RETRY": ("network.retry", int),
    "HDREZKA_JSON_OUTPUT": ("output.json", bool),
    "HDREZKA_NO_COLOR": ("output.color", lambda x: not x),
}


class Config:
    """Configuration manager with file and environment variable support."""

    def __init__(self, config_path: str | Path | None = None) -> None:
        """Initialize configuration.

        Args:
            config_path: Path to config file (default: ~/.config/hdrezka/config.toml)

        Raises:
            ConfigError: If config file is malformed
        """
        # Resolve config path
        if config_path:
            self.config_path = Path(config_path)
        elif env_config := os.getenv("HDREZKA_CONFIG"):
            self.config_path = Path(env_config)
        else:
            self.config_path = Path.home() / ".config" / "hdrezka" / "config.toml"

        # Load configuration
        self._config: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        """Load configuration from file and environment variables.

        Raises:
            ConfigError: If config file exists but is malformed
        """
        # Start with defaults (deep copy to avoid mutating DEFAULT_CONFIG)
        self._config = deepcopy(DEFAULT_CONFIG)

        # Load from file if exists
        if self.config_path.exists():
            try:
                with open(self.config_path) as f:
                    file_config = toml.load(f)
                self._merge_config(file_config)
            except toml.TomlDecodeError as e:
                raise ConfigError(
                    f"Malformed config file: {self.config_path}",
                    {"error": str(e)}
                ) from e
            except OSError as e:
                raise ConfigError(
                    f"Cannot read config file: {self.config_path}",
                    {"error": str(e)}
                ) from e

        # Override with environment variables
        self._load_env_vars()

    def _merge_config(self, new_config: dict[str, Any]) -> None:
        """Merge new config into existing config recursively.

        Args:
            new_config: Configuration to merge
        """
        for section, values in new_config.items():
            if section not in self._config:
                self._config[section] = values
            elif isinstance(values, dict):
                self._config[section].update(values)
            else:
                self._config[section] = values

    def _load_env_vars(self) -> None:
        """Override config values from environment variables."""
        for env_var, (config_key, converter) in ENV_MAPPINGS.items():
            if value := os.getenv(env_var):
                try:
                    converted_value = converter(value)
                    self._set_nested_value(config_key, converted_value)
                except (ValueError, TypeError) as e:
                    raise ConfigError(
                        f"Invalid environment variable value: {env_var}={value}",
                        {"error": str(e)}
                    ) from e

    def _set_nested_value(self, key: str, value: Any) -> None:
        """Set a nested configuration value using dot notation.

        Args:
            key: Configuration key in dot notation (e.g., "default.quality")
            value: Value to set
        """
        keys = key.split(".")
        config = self._config

        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]

        config[keys[-1]] = value

    def _get_nested_value(self, key: str, default: Any = None) -> Any:
        """Get a nested configuration value using dot notation.

        Args:
            key: Configuration key in dot notation (e.g., "default.quality")
            default: Default value if key not found

        Returns:
            Configuration value or default
        """
        keys = key.split(".")
        config = self._config

        for k in keys:
            if isinstance(config, dict) and k in config:
                config = config[k]
            else:
                return default

        return config

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value.

        Args:
            key: Configuration key in dot notation (e.g., "default.quality")
            default: Default value if key not found

        Returns:
            Configuration value or default
        """
        return self._get_nested_value(key, default)

    def set(self, key: str, value: Any) -> None:
        """Set a configuration value.

        Args:
            key: Configuration key in dot notation (e.g., "default.quality")
            value: Value to set
        """
        self._set_nested_value(key, value)

    def save(self) -> None:
        """Save configuration to file.

        Raises:
            ConfigError: If config file cannot be written
        """
        try:
            # Create parent directories if needed
            self.config_path.parent.mkdir(parents=True, exist_ok=True)

            # Write config file
            with open(self.config_path, "w") as f:
                toml.dump(self._config, f)
        except OSError as e:
            raise ConfigError(
                f"Cannot write config file: {self.config_path}",
                {"error": str(e)}
            ) from e

    def reset(self) -> None:
        """Reset configuration to defaults."""
        self._config = deepcopy(DEFAULT_CONFIG)

    @property
    def quality(self) -> Quality:
        """Get default quality setting."""
        return cast(Quality, self.get("default.quality", "720p"))

    @property
    def translator_index(self) -> int:
        """Get default translator index."""
        return cast(int, self.get("default.translator_index", 0))

    @property
    def output_directory(self) -> Path:
        """Get default output directory."""
        path_str = cast(str, self.get("default.output_directory", "~/Downloads"))
        return Path(path_str).expanduser()

    @property
    def proxy(self) -> str | None:
        """Get proxy setting."""
        return cast(str | None, self.get("network.proxy"))

    @property
    def timeout(self) -> int:
        """Get network timeout setting."""
        return cast(int, self.get("network.timeout", 30))

    @property
    def retry_count(self) -> int:
        """Get retry count setting."""
        return cast(int, self.get("network.retry", 3))

    @property
    def retry_delay(self) -> float:
        """Get retry delay setting."""
        return cast(float, self.get("network.retry_delay", 1.0))

    @property
    def json_output(self) -> bool:
        """Get JSON output setting."""
        return cast(bool, self.get("output.json", False))

    @property
    def color_output(self) -> bool:
        """Get color output setting."""
        return cast(bool, self.get("output.color", True))

    @property
    def ssh_host(self) -> str | None:
        """Get SSH host setting."""
        return cast(str | None, self.get("ssh.host"))

    @property
    def ssh_path(self) -> str | None:
        """Get SSH path setting."""
        return cast(str | None, self.get("ssh.path"))

    @property
    def ssh_user(self) -> str | None:
        """Get SSH user setting."""
        return cast(str | None, self.get("ssh.user"))


def get_config(config_path: str | Path | None = None) -> Config:
    """Get a Config instance.

    Args:
        config_path: Optional path to config file

    Returns:
        Config instance
    """
    return Config(config_path)
