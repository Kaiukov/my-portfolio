"""MCP server for SearXNG web search."""

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, ConfigDict

# Default SearXNG instance
DEFAULT_BASE_URL = os.getenv(
    "SEARXNG_BASE_URL",
    "http://zimaos.neon-chuckwalla.ts.net:3000"
)

mcp = FastMCP("SearXNG Web Search")


class SearchResult(BaseModel):
    """A single search result from SearXNG."""

    model_config = ConfigDict(frozen=True)

    title: str = Field(description="Title of the search result")
    url: str = Field(description="URL of the search result")
    content: str = Field(default="", description="Full content of the page (if available)")
    snippet: str = Field(default="", description="Brief snippet/preview of the content")


def build_searxng_url(base_url: str, query: str) -> str:
    """Build SearXNG search URL."""
    return f"{base_url.rstrip('/')}/search?q={query}&format=json"


async def fetch_search_results(base_url: str, query: str) -> dict[str, Any]:
    """Fetch results from SearXNG API."""
    url = build_searxng_url(base_url, query)

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"SearXNG API error: {e.response.status_code} - {e.response.text}") from e
        except httpx.RequestError as e:
            raise RuntimeError(f"Failed to reach SearXNG: {e}") from e


def parse_search_results(data: dict[str, Any]) -> list[SearchResult]:
    """Parse SearXNG response into SearchResult objects."""
    raw_results = data.get("results", [])

    parsed = []
    for item in raw_results:
        try:
            result = SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                content=item.get("content", ""),
                snippet=item.get("snippet", ""),
            )
            parsed.append(result)
        except Exception:
            # Skip malformed results
            continue

    return parsed


@mcp.tool()
async def web_search(
    query: str,
    base_url: str = DEFAULT_BASE_URL,
) -> str:
    """Search the web using SearXNG.

    Args:
        query: Search query string. Use specific, targeted keywords for best results.
        base_url: SearXNG instance base URL (optional, uses default if not provided)

    Returns:
        A list of relevant web pages with titles, URLs, and content snippets formatted as markdown.
    """
    try:
        data = await fetch_search_results(base_url, query)
        results = parse_search_results(data)

        if not results:
            return f"No results found for query: {query}"

        # Format results as markdown
        lines = [f"## Search Results for: {query}\n"]
        lines.append(f"Found {len(results)} result(s)\n")

        for i, result in enumerate(results, 1):
            lines.append(f"### {i}. {result.title}")
            lines.append(f"**URL**: {result.url}")
            if result.snippet:
                lines.append(f"**Snippet**: {result.snippet}")
            if result.content:
                # Truncate long content
                content = result.content[:500] + "..." if len(result.content) > 500 else result.content
                lines.append(f"**Content**: {content}")
            lines.append("")

        return "\n".join(lines)

    except RuntimeError as e:
        return f"Search failed: {e}"
    except Exception as e:
        return f"Unexpected error: {e}"


def main() -> None:
    """Run the MCP server."""
    import asyncio

    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
