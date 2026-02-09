#!/usr/bin/env python3
"""
Ukrainian News Fetcher for Investment Monitoring
Fetches latest Ukrainian economic and financial news
"""

import requests
import json
from datetime import datetime
from typing import List, Dict
import sys

class UkrainianNewsFetcher:
    def __init__(self, searxng_url: str = "http://zimaos.neon-chuckwalla.ts.net:3000"):
        self.searxng_url = searxng_url
        self.results = {}
        
    def search(self, query: str, lang: str = "en") -> List[Dict]:
        """Search using Searxng"""
        try:
            response = requests.get(
                f"{self.searxng_url}/search",
                params={
                    "q": query,
                    "format": "json",
                    "language": lang,
                    "pageno": 1,
                    "number": 10
                },
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                results = data.get("results", [])
                
                # Filter out Russian sources
                filtered = [r for r in results if not ".ru" in r.get("url", "")]
                return filtered
            else:
                print(f"Error: {response.status_code}")
                return []
                
        except Exception as e:
            print(f"Search failed for '{query}': {e}", file=sys.stderr)
            return []
    
    def fetch_all_queries(self) -> Dict[str, List[Dict]]:
        """Fetch news for all Ukrainian queries"""
        
        queries = {
            "en": [
                "Ukraine investment news February 2026",
                "Ukraine bonds eurobonds news 2026",
                "Ukrainian economy news today 2026",
                "Ukraine war peace negotiations February 2026",
            ],
            "uk": [
                "Україна інвестиції новини лютий 2026",
                "ОВГЗ Україна новини",
                "НБУ новини лютий 2026",
                "Україна фондовий ринок 2026",
            ]
        }
        
        all_results = {}
        
        for lang, query_list in queries.items():
            for query in query_list:
                print(f"Fetching: {query}")
                results = self.search(query, lang=lang)
                all_results[query] = results
                
        return all_results
    
    def format_markdown(self, all_results: Dict[str, List[Dict]]) -> str:
        """Format results as Markdown"""
        
        md = f"""# Ukrainian News Summary
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

"""
        
        # Collect unique URLs to avoid duplicates
        seen_urls = set()
        articles = []
        
        for query, results in all_results.items():
            for result in results:
                url = result.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    articles.append({
                        "title": result.get("title", "No Title"),
                        "url": url,
                        "snippet": result.get("content", ""),
                        "engine": result.get("engine", "Unknown"),
                    })
        
        # Sort by relevance and format top 10
        for i, article in enumerate(articles[:10], 1):
            md += f"""## {i}. {article['title']}
**Source:** [{article['engine']}]({article['url']})

{article['snippet']}

"""
        
        return md

def main():
    fetcher = UkrainianNewsFetcher()
    print("Fetching Ukrainian news...")
    
    results = fetcher.fetch_all_queries()
    
    # Save raw JSON
    with open("/home/kaiukov/my-portfolio/tmp/ukr_news_raw.json", "w") as f:
        json.dump(results, f, indent=2)
    
    # Save formatted markdown
    markdown = fetcher.format_markdown(results)
    with open("/home/kaiukov/my-portfolio/tmp/ukr_news.md", "w") as f:
        f.write(markdown)
    
    print("News saved to /home/kaiukov/my-portfolio/tmp/ukr_news.md")
    print(f"Total articles found: {sum(len(r) for r in results.values())}")

if __name__ == "__main__":
    main()
