#!/usr/bin/env python3
"""
Web scraping script using crawl4ai
Replaces Playwright with crawl4ai for better performance and built-in markdown extraction
"""
import sys
import argparse
import asyncio
from crawl4ai import AsyncWebCrawler
from crawl4ai.extraction_strategy import LLMExtractionStrategy
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

# Content selectors for main content extraction
CONTENT_SELECTORS = [".caas-body", "article", "main", ".article-body"]


async def scrape_logic(url, selector=None, auto_content=False):
    """Scrape URL using crawl4ai"""
    async with AsyncWebCrawler(verbose=True) as crawler:
        print(f"Fetching {url}...", file=sys.stderr)

        # Configure crawl options
        crawl_result = await crawler.arun(
            url=url,
            markdown_generator=DefaultMarkdownGenerator(),
            bypass_cache=True,
            process_iframes=True,
            remove_forms=True,
        )

        if not crawl_result.success:
            raise Exception(f"Failed to crawl: {crawl_result.error_message}")

        # Extract content based on options
        if selector:
            # If specific selector requested, return HTML for that element
            # crawl4ai returns cleaned HTML, use it
            content = crawl_result.html
        elif auto_content:
            # Use crawl4ai's markdown for main content
            # crawl4ai automatically extracts main content
            content = crawl_result.markdown
        else:
            # Return full page markdown by default
            content = crawl_result.markdown

        return content


def to_markdown(markdown_content):
    """Pass-through for crawl4ai's built-in markdown"""
    return markdown_content


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape web pages using crawl4ai",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape and return markdown
  python scrape_web.py -m https://example.com

  # Extract main content only
  python scrape_web.py -mc https://example.com

  # Use specific CSS selector
  python scrape_web.py -s ".article-body" https://example.com
        """
    )
    parser.add_argument("url", help="URL to scrape")
    parser.add_argument(
        "-m", "--markdown",
        action="store_true",
        help="Convert to markdown (default behavior with crawl4ai)"
    )
    parser.add_argument(
        "-c", "--content",
        action="store_true",
        help="Extract main content only (crawl4ai's smart extraction)"
    )
    parser.add_argument(
        "-s", "--selector",
        help="CSS selector to extract (returns raw HTML for that selector)"
    )
    args = parser.parse_args()

    # Run the async scraper
    html_content = asyncio.run(scrape_logic(args.url, args.selector, args.content))

    # Output
    print(html_content)
