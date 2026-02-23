#!/usr/bin/env python3
"""
Cryptocurrency Market News Analyzer
Distinguishes between short-term noise and long-term signals for institutional-grade assets
Focus: BTC, ETH, BNB, SOL, XRP, USDC, USDT, stablecoins
"""

import json
import sys
from datetime import datetime, timedelta
from typing import List, Dict, Tuple

# Confidence Score Weights
WEIGHTS = {
    'source_reliability': 0.30,
    'clarity': 0.25,
    'directness': 0.25,
    'consensus': 0.20
}

MINIMUM_CONFIDENCE_SCORE = 88.0

class NewsAnalyzer:
    def __init__(self):
        self.focus_assets = {'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'USDC', 'USDT'}
        self.tier1_sources = {
            'Coindesk', 'The Block', 'Bloomberg', 'Reuters',
            'CoinMarketCap', 'Official announcements'
        }
        self.tier2_sources = {
            'Cointelegraph', 'Decrypt', 'CoinGecko'
        }
    
    def calculate_confidence_score(
        self,
        source_reliability: float,
        clarity: float,
        directness: float,
        consensus: float
    ) -> float:
        """Calculate weighted confidence score"""
        return (
            (source_reliability * WEIGHTS['source_reliability']) +
            (clarity * WEIGHTS['clarity']) +
            (directness * WEIGHTS['directness']) +
            (consensus * WEIGHTS['consensus'])
        )
    
    def assess_economic_moat(self, news_summary: str) -> Tuple[str, str]:
        """
        Filter 1: Economic Moat
        Assess if news changes competitive advantage
        """
        verdict = "NO_CHANGE"
        reasoning = "Unable to determine from summary"
        
        # Check for moat-affecting keywords
        moat_keywords_positive = [
            'dominance', 'adoption', 'developer',
            'network effect', 'market share', 'competitive'
        ]
        moat_keywords_negative = [
            'lost users', 'exodus', 'fork', 'vulnerability'
        ]
        
        text = news_summary.lower()
        if any(kw in text for kw in moat_keywords_negative):
            verdict = "WEAKENS"
        elif any(kw in text for kw in moat_keywords_positive):
            verdict = "STRENGTHENS"
        
        return verdict, reasoning
    
    def assess_macro_structural(self, news_summary: str) -> Tuple[str, str]:
        """
        Filter 2: Macro/Structural
        Assess lasting market framework impact
        """
        verdict = "NEUTRAL"
        reasoning = ""
        
        macro_keywords = {
            'positive': ['regulation', 'adoption', 'institutional', 'SEC', 'approval'],
            'negative': ['ban', 'restrict', 'delisting', 'crackdown'],
            'neutral': ['update', 'deployment', 'minor']
        }
        
        text = news_summary.lower()
        if any(kw in text for kw in macro_keywords['negative']):
            verdict = "NEGATIVE"
        elif any(kw in text for kw in macro_keywords['positive']):
            verdict = "POSITIVE"
        
        return verdict, reasoning
    
    def assess_value_vs_price(self, news_summary: str) -> Tuple[str, str]:
        """
        Filter 3: Value vs. Price
        Determine if price reaction matches fundamental impact
        """
        verdict = "PROPORTIONAL"
        reasoning = ""
        
        return verdict, reasoning
    
    def analyze_news(self, news_item: Dict) -> Dict:
        """
        Complete analysis of a news item
        """
        # Extract scores (would come from analysis)
        sr = news_item.get('source_reliability', 85)
        clarity = news_item.get('clarity', 80)
        directness = news_item.get('directness', 75)
        consensus = news_item.get('consensus', 90)
        
        confidence = self.calculate_confidence_score(sr, clarity, directness, consensus)
        
        result = {
            'headline': news_item.get('headline', 'Unknown'),
            'source': news_item.get('source', 'Unknown'),
            'confidence_score': round(confidence, 2),
            'passes_threshold': confidence >= MINIMUM_CONFIDENCE_SCORE,
            'verdict': 'NOISE'
        }
        
        if confidence >= MINIMUM_CONFIDENCE_SCORE:
            # Apply three filters
            moat_verdict, moat_reason = self.assess_economic_moat(
                news_item.get('summary', '')
            )
            macro_verdict, macro_reason = self.assess_macro_structural(
                news_item.get('summary', '')
            )
            value_verdict, value_reason = self.assess_value_vs_price(
                news_item.get('summary', '')
            )
            
            result['filters'] = {
                'economic_moat': moat_verdict,
                'macro_structural': macro_verdict,
                'value_vs_price': value_verdict
            }
            
            # Determine final verdict
            if moat_verdict == "STRENGTHENS" and macro_verdict in ["POSITIVE", "NEUTRAL"]:
                result['verdict'] = 'ACTIONABLE_SIGNAL'
            elif macro_verdict == "NEGATIVE":
                result['verdict'] = 'SELL_SIGNAL'
            else:
                result['verdict'] = 'MONITOR'
        
        return result
    
    def generate_report(self, analyses: List[Dict]) -> str:
        """Generate markdown report of analyses"""
        report = "## Crypto Market News Summary\n\n"
        
        actionable = [a for a in analyses if a['passes_threshold']]
        
        report += f"### Headlines with Confidence Score >= {MINIMUM_CONFIDENCE_SCORE}%\n\n"
        report += "Signal|Confidence Score|Verdict|Reasoning\n"
        report += "-|-|-|-\n"
        
        for item in sorted(actionable, key=lambda x: x['confidence_score'], reverse=True):
            report += f"{item['headline']}|{item['confidence_score']}%|{item['verdict']}|See filters\n"
        
        return report


def main():
    analyzer = NewsAnalyzer()
    
    # Example usage
    if len(sys.argv) > 1 and sys.argv[1] == '--help':
        print("""
Cryptocurrency Market News Analyzer
Usage: crypto-news-analyzer.py [--help] [--analyze JSON_FILE]

Analyzes crypto news to distinguish noise from actionable signals.
Applies three filters:
1. Economic Moat (competitive advantage)
2. Macro/Structural (lasting framework changes)
3. Value vs. Price (fundamental vs sentiment)

Minimum confidence threshold: 88%
Focus assets: BTC, ETH, BNB, SOL, XRP, USDC, USDT, stablecoins
        """)
        return
    
    print("Cryptocurrency Market News Analyzer Ready")
    print(f"Minimum confidence threshold: {MINIMUM_CONFIDENCE_SCORE}%")
    print(f"Focus assets: {', '.join(sorted(analyzer.focus_assets))}")


if __name__ == '__main__':
    main()
