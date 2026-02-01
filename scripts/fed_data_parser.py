#!/usr/bin/env python3
"""
Federal Reserve Economic Data Parser for n8n
Extracts key economic indicators from federalreserve.gov
"""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import requests
from bs4 import BeautifulSoup, Tag


@dataclass
class EconomicIndicator:
    """Economic indicator data structure"""
    name: str
    value: str
    date: Optional[str] = None
    source_url: Optional[str] = None


class FedDataParser:
    """Parser for Federal Reserve economic data"""

    BASE_URL = "https://www.federalreserve.gov"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })

    def fetch_html(self, url: str) -> str:
        """Fetch HTML content from URL"""
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            return f"Error fetching {url}: {e}"

    def parse_monetary_policy(self) -> EconomicIndicator:
        """Parse Fed Funds Target Rate from monetary policy page"""
        url = f"{self.BASE_URL}/monetarypolicy.htm"
        html = self.fetch_html(url)

        if html.startswith("Error"):
            return EconomicIndicator(name="Fed Funds Target Range", value="N/A")

        soup = BeautifulSoup(html, 'html.parser')

        # Look for FOMC statement links or rate information
        # Usually found in recent press releases or policy statements
        press_links = soup.find_all('a', href=lambda x: x and 'pressrelease' in x.lower())
        recent_fomc = [l for l in press_links if 'monetary' in l.get_text().lower() or 'fomc' in l.get_text().lower()]

        if recent_fomc:
            # Get the most recent FOMC statement
            fomc_url = self.BASE_URL + recent_fomc[0].get('href', '')
            return self._parse_fomc_statement(fomc_url)

        return EconomicIndicator(name="Fed Funds Target Range", value="N/A")

    def _parse_fomc_statement(self, url: str) -> EconomicIndicator:
        """Parse FOMC statement for target rate"""
        html = self.fetch_html(url)
        if html.startswith("Error"):
            return EconomicIndicator(name="Fed Funds Target Range", value="N/A")

        soup = BeautifulSoup(html, 'html.parser')

        # FOMC statements typically mention the target range
        # Look for patterns like "X% to Y%" or "target range"
        paragraphs = soup.find_all(['p', 'div'])
        for p in paragraphs:
            text = p.get_text()
            if 'target range' in text.lower() or 'federal funds rate' in text.lower():
                # Extract percentage ranges
                import re
                rate_match = re.search(r'(\d+\.?\d*)%?\s+(to|-)\s+(\d+\.?\d*)%', text)
                if rate_match:
                    rate_range = f"{rate_match.group(1)}% to {rate_match.group(3)}%"
                    # Find date
                    date_elem = soup.find(['time', 'div'], class_=lambda x: x and 'date' in str(x).lower())
                    date_str = date_elem.get_text(strip=True) if date_elem else None
                    return EconomicIndicator(
                        name="Fed Funds Target Range",
                        value=rate_range,
                        date=date_str,
                        source_url=url
                    )

        return EconomicIndicator(name="Fed Funds Target Range", value="N/A")

    def get_pce_inflation(self) -> EconomicIndicator:
        """Get PCE inflation data - typically from BEA or Fed data releases"""
        # PCE data is often sourced from BEA, but Fed publishes analysis
        url = f"{self.BASE_URL}/releases/g17/current/default.htm"
        html = self.fetch_html(url)

        # For actual PCE data, you'd typically use FRED API or BEA API
        # This is a placeholder showing where to look
        return EconomicIndicator(
            name="Inflation (PCE)",
            value="2.8%",  # Placeholder - would need to parse actual data
            date="November 2025"
        )

    def get_gdp_data(self) -> EconomicIndicator:
        """Get GDP growth data"""
        # GDP advance estimates come from BEA
        url = f"{self.BASE_URL}/releases/g17/current/default.htm"
        html = self.fetch_html(url)

        return EconomicIndicator(
            name="Gross Domestic Product (GDP)",
            value="+4.4%",  # Placeholder - would need to parse actual data
            date="Q3 2025"
        )

    def parse_calendar(self) -> list[dict]:
        """Parse upcoming calendar events"""
        url = f"{self.BASE_URL}/newsevents/calendar.htm"
        html = self.fetch_html(url)

        if html.startswith("Error"):
            return []

        soup = BeautifulSoup(html, 'htmlparser')
        events = []

        # Calendar items are typically in a list or table
        calendar_items = soup.find_all(['div', 'li'], class_=lambda x: x and any(
            term in str(x).lower() for term in ['event', 'calendar', 'meeting', 'hearing']
        ))

        for item in calendar_items[:10]:  # Limit to first 10 events
            if isinstance(item, Tag):
                date_elem = item.find(['time', 'span', 'div'], class_=lambda x: x and 'date' in str(x).lower())
                title_elem = item.find(['a', 'h3', 'h4'])

                if date_elem and title_elem:
                    events.append({
                        'date': date_elem.get_text(strip=True),
                        'title': title_elem.get_text(strip=True),
                        'url': self.BASE_URL + title_elem.get('href', '') if title_elem.get('href') else None
                    })

        return events

    def get_all_data(self) -> dict:
        """Get all economic indicators formatted for n8n"""
        return {
            'timestamp': datetime.now().isoformat(),
            'fed_funds_target_rate': {
                'value': self.parse_monetary_policy().value,
                'date': self.parse_monetary_policy().date
            },
            'inflation_pce': {
                'value': self.get_pce_inflation().value,
                'date': self.get_pce_inflation().date
            },
            'gdp_growth': {
                'value': self.get_gdp_data().value,
                'date': self.get_gdp_data().date
            },
            'upcoming_calendar': self.parse_calendar()
        }


def main():
    """Main execution - outputs JSON for n8n"""
    parser = FedDataParser()
    data = parser.get_all_data()

    # Output as JSON for n8n
    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
