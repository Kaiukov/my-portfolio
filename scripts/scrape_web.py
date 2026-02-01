#!/usr/bin/env python3
"""
Web scraping script using crawl4ai or Playwright
- --depth simple: fast crawl4ai (may hit cookie walls)
- --depth deep: Playwright with auto cookie-dismiss
"""
import sys
import argparse
import asyncio
import re
from crawl4ai import AsyncWebCrawler
from crawl4ai.extraction_strategy import LLMExtractionStrategy
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
from playwright.async_api import async_playwright

# Content selectors for main content extraction
CONTENT_SELECTORS = [".caas-body", "article", "main", ".article-body"]

# Cookie consent button selectors (multi-language)
CONSENT_SELECTORS = [
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("Acceptați tot")',
    'button:has-text("Tout accepter")',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Aceptar todo")',
    'button:has-text("Reject all")',
    'button:has-text("Respingeți tot")',
    'button:has-text("Tout refuser")',
    'button[aria-label*="accept" i]',
    'button[aria-label*="Accept" i]',
    ".consent-button",
    "#consent-accept",
    'button:has-text("Agree")',
    'button:has-text("I agree")',
]


def html_to_markdown(html_content):
    """Convert HTML to markdown format"""
    if not html_content:
        return ""

    # Remove script/style tags
    html_content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<style[^>]*>.*?</style>', '', html_content, flags=re.DOTALL | re.IGNORECASE)

    # Headers
    html_content = re.sub(r'<h1[^>]*>(.*?)</h1>', r'# \1\n', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<h2[^>]*>(.*?)</h2>', r'## \1\n', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<h3[^>]*>(.*?)</h3>', r'### \1\n', html_content, flags=re.DOTALL | re.IGNORECASE)

    # Bold/italic
    html_content = re.sub(r'<strong[^>]*>(.*?)</strong>', r'**\1**', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<b[^>]*>(.*?)</b>', r'**\1**', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<em[^>]*>(.*?)</em>', r'*\1*', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<i[^>]*>(.*?)</i>', r'*\1*', html_content, flags=re.DOTALL | re.IGNORECASE)

    # Links
    html_content = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', r'[\2](\1)', html_content, flags=re.DOTALL | re.IGNORECASE)

    # Paragraphs and line breaks
    html_content = re.sub(r'<p[^>]*>(.*?)</p>', r'\1\n\n', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<br[^>]*>', '\n', html_content, flags=re.IGNORECASE)

    # Lists
    html_content = re.sub(r'<li[^>]*>(.*?)</li>', r'- \1\n', html_content, flags=re.DOTALL | re.IGNORECASE)

    # Remove remaining tags
    html_content = re.sub(r'<[^>]+>', '', html_content)

    # Clean up whitespace
    html_content = re.sub(r'\n{3,}', '\n\n', html_content)
    html_content = html_content.strip()

    return html_content


async def scrape_with_playwright(url, timeout=30000):
    """Scrape using Playwright with cookie consent handling"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        )
        page = await context.new_page()

        try:
            print(f"[Playwright] Fetching: {url}", file=sys.stderr)
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout)

            # Try to dismiss cookie consent
            for selector in CONSENT_SELECTORS:
                try:
                    el = page.locator(selector).first
                    if await el.count() > 0:
                        await el.click(timeout=1000)
                        await page.wait_for_timeout(1000)
                        print(f"[Playwright] Dismissed consent: {selector}", file=sys.stderr)
                        break
                except:
                    continue

            # Wait for content to load
            await page.wait_for_timeout(2000)

            # Extract main content as text
            content = await page.evaluate("""() => {
                const selectors = [".caas-body", "article", "main", ".article-body", "[data-test-id='article-body']", ".post-content", ".entry-content"];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        // Get HTML for markdown conversion
                        return el.innerHTML;
                    }
                }
                // Fallback to body
                return document.body.innerHTML;
            }""")

            return html_to_markdown(content)

        finally:
            await browser.close()


async def scrape_logic(url, selector=None, auto_content=False, depth="simple"):
    """Scrape URL using crawl4ai or Playwright based on depth"""
    if depth == "deep":
        return await scrape_with_playwright(url)

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
        description="Scrape web pages using crawl4ai or Playwright",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Fast scrape with crawl4ai (may hit cookie walls)
  python scrape_web.py -m --depth simple https://example.com

  # Deep scrape with Playwright (handles cookie consent)
  python scrape_web.py -m --depth deep https://example.com

  # Extract main content only
  python scrape_web.py -c --depth simple https://example.com
        """
    )
    parser.add_argument("url", help="URL to scrape")
    parser.add_argument(
        "-m", "--markdown",
        action="store_true",
        help="Output as markdown (default)"
    )
    parser.add_argument(
        "-c", "--content",
        action="store_true",
        help="Extract main content only"
    )
    parser.add_argument(
        "-s", "--selector",
        help="CSS selector to extract"
    )
    parser.add_argument(
        "--depth",
        choices=["simple", "deep"],
        default="simple",
        help="simple=crawl4ai (fast), deep=Playwright (handles cookies)"
    )
    args = parser.parse_args()

    # Run the async scraper
    html_content = asyncio.run(scrape_logic(args.url, args.selector, args.content, args.depth))

    # Output
    print(html_content)
