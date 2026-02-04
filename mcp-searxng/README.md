# MCP SearXNG Web Search Server

MCP server for web search using SearXNG meta-search engine.

## Installation

```bash
# Install in development mode
uv pip install -e .

# Or with pip
pip install -e .
```

## Configuration

Set `SEARXNG_BASE_URL` environment variable or use default:

```bash
export SEARXNG_BASE_URL="http://your-searxng-instance:3000"
```

## Usage

### Run with MCP Inspector

```bash
npx @modelcontextprotocol/inspector mcp-searxng
```

### Run directly

```bash
mcp-searxng
```

## Tools

### `web_search`

Search the web and get formatted markdown results.

**Parameters:**
- `query` (required): Search query string
- `base_url` (optional): SearXNG instance URL (uses default/env if not provided)

**Example:**
```json
{
  "query": "python async await",
  "base_url": "http://localhost:3000"
}
```

## Development

```bash
# Run tests
uv run python test_server.py

# Build
uv pip install -e .
```
