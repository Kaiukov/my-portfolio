# Cryptocurrency Market News Analysis Framework

**Created**: 2026-02-23  
**Status**: Ready for Implementation  
**Version**: 1.0  

## Executive Summary

This framework enables systematic analysis of cryptocurrency market news to distinguish between:
- **Short-term noise** (emotional price movements, minor announcements)
- **Long-term signals** (structural changes, competitive dynamics, regulatory shifts)

### Key Metrics

- **Minimum Confidence Threshold**: 88%
- **Focus Assets**: BTC, ETH, BNB, SOL, XRP, USDC, USDT, stablecoins
- **Analysis Horizon**: 24-hour rolling window (customizable)
- **Expected Signal Frequency**: 1-3 actionable signals per week in normal markets

## Quick Start

### 1. Memory Files (Persistent)

Located in: `/home/kaiukov/my-portfolio/.claude/agent-memory/crypto-signal-analyzer/`

- **MEMORY.md** - Core framework and key insights
- **analysis-methodology.md** - Detailed scoring methodology
- **analysis-template.md** - Step-by-step analysis template
- **practical-implementation.md** - Implementation guide with examples
- **signals-log.md** - Tracking of past signals and outcomes (to be created)

### 2. Python Script

Located in: `/home/kaiukov/my-portfolio/scripts/crypto-news-analyzer.py`

Usage:
```bash
python /home/kaiukov/my-portfolio/scripts/crypto-news-analyzer.py --help
```

### 3. Workflow

```
News Source
    ↓
Filter by Focus Assets
    ↓
Calculate Confidence Score
    ↓
Score >= 88%?
    ├─ NO → Mark as NOISE, Stop
    └─ YES → Apply Three Filters
        ├─ Economic Moat Filter
        ├─ Macro/Structural Filter
        └─ Value vs. Price Filter
            ↓
        Output Investment Signal
```

## The Three Filters Explained

### Filter 1: Economic Moat (Does this change competitive positioning?)

Evaluates whether the news affects:
- Market share trajectory
- Competitive advantages (speed, cost, functionality)
- Network effects strength
- Developer ecosystem health
- Long-term profitability

**Signals for Action**: News that STRENGTHENS moat fundamentally

### Filter 2: Macro/Structural (Is this a lasting framework change?)

Assesses impact on:
- Regulatory environment (jurisdictional weighted)
- Interest rate regime effects
- Adoption acceleration/deceleration
- Infrastructure maturity shifts
- Cross-border capital flows

**Signals for Action**: Structural changes that affect entire market class

### Filter 3: Value vs. Price (Does price match fundamental impact?)

Determines:
- Expected vs. actual market reaction
- Sentiment-driven vs. fundamental repricing
- Overreaction/underreaction potential
- Price correction likelihood
- Entry points for long-term holders

**Signals for Action**: Divergences between price movement and fundamental value

## Confidence Score Formula

```
Score = (Source_Reliability × 0.30) 
      + (Clarity × 0.25) 
      + (Directness × 0.25) 
      + (Consensus × 0.20)
```

### Component Breakdown

#### Source Reliability (30% weight)
- Tier 1 (95-100): Official announcements, Coindesk, The Block, Bloomberg, Reuters
- Tier 2 (75-89): Cointelegraph, Decrypt, CoinMarketCap
- Tier 3 (55-69): Secondary sources, aggregators, industry blogs
- Tier 4 (<50): Social media, unverified sources

#### Clarity & Specificity (25% weight)
- High (85-100%): Specific numbers, quantifiable impact, clear causality
- Medium (60-84%): General statements with some detail
- Low (30-59%): Vague claims, interpretive language
- Very Low (0-29%): Speculative, unclear impact

#### Directness of Impact (25% weight)
- Direct (90-100%): Revenue/user/volume effect within 30 days
- Moderately Direct (70-89%): Clear connection, 30-90 days to materialize
- Indirect (50-69%): Secondary effects, requires assumptions
- Negligible (0-49%): Tangential or theoretical

#### Consensus & Conflict (20% weight)
- Base: 100% (single credible source)
- Consensus boost: +10% (multiple sources align)
- Debate penalty: -10% (significant expert disagreement)

## News Categories & Treatment

| Category | What Counts | Time to Impact | Example |
|----------|-------------|-----------------|---------|
| **Regulatory** | Enacted laws, SEC guidance, formal approvals | 3-12 months | SEC approves Bitcoin ETF |
| **Adoption** | Major institutional adoption, major exchange listings | 1-6 months | BlackRock Bitcoin trading |
| **Technical** | Mainnet launches, major upgrades, audits | Immediate to 12 mo | Ethereum fee reduction |
| **Market Share** | Developer migration, ecosystem shifts | 6-24 months | Solana adoption surge |
| **Macroeconomic** | Fed decisions, inflation data, rate changes | 2-8 weeks | Fed rate increase |
| **Crisis** | Exchange insolvency, protocol hack, crackdown | Immediate to 3 mo | Stablecoin crisis |

## Implementation Checklist

- [ ] Review MEMORY.md for framework overview
- [ ] Study analysis-methodology.md for scoring details
- [ ] Use analysis-template.md for each news analysis
- [ ] Follow practical-implementation.md for workflow
- [ ] Create signals-log.md to track past predictions
- [ ] Run crypto-news-analyzer.py for template validation
- [ ] Generate daily/weekly reports to portfolio_reports/
- [ ] Track signal accuracy monthly

## Files Reference

```
/home/kaiukov/my-portfolio/
├── .claude/
│   └── agent-memory/
│       └── crypto-signal-analyzer/
│           ├── MEMORY.md                           [Framework & Key Insights]
│           ├── analysis-methodology.md             [Scoring Details]
│           ├── analysis-template.md                [Step-by-Step Template]
│           ├── practical-implementation.md         [Implementation Guide]
│           └── signals-log.md                      [Tracking Log - To Create]
├── scripts/
│   └── crypto-news-analyzer.py                     [Python Analysis Tool]
├── portfolio_reports/
│   └── YYYY-MM-DD-crypto-market-analysis.md       [Daily Reports]
└── CRYPTO_ANALYSIS_FRAMEWORK.md                    [This File]
```

## Common Mistakes to Avoid

1. **Treating all sources equally** - Always weight by tier (Coindesk > Twitter)
2. **Confusing correlation with causation** - Look for explicit connection
3. **Overweighting recent news** - Consider trend, not just latest announcement
4. **Assuming price = value** - Crypto markets often misprice for weeks
5. **Ignoring geopolitical context** - US regulatory news carries 50% of weight
6. **Mistaking volatility for opportunity** - Volatility ≠ signal
7. **Confirmation bias** - Actively seek conflicting viewpoints
8. **Not tracking outcomes** - Record predictions vs actual to improve

## Long-Term Tracking

Monthly, review:
1. Signal accuracy rate (predictions vs outcomes)
2. Filter effectiveness (which filter catches most false signals?)
3. Source reliability changes (has any source degraded?)
4. Time horizon accuracy (were impact predictions correct?)

Use this data to refine the framework quarterly.

## Integration with Existing Systems

This framework integrates with your current:
- **News Pipeline**: `.claude/commands/news.md`
- **Agent System**: `scripts/agent.py`
- **Report Generation**: `portfolio_reports/`

Recommended integration:
1. Add crypto analysis module to daily news command
2. Feed actionable signals to position monitoring
3. Use signals for rebalancing decisions
4. Track signal accuracy in portfolio metrics

## Support & Refinement

This is a Version 1.0 framework. It will evolve based on:
- Real-world signal accuracy tracking
- Changes in crypto market structure
- Regulatory environment shifts
- New asset classes added to focus list

Record all learnings in persistent memory for future improvement.

---

**Last Updated**: 2026-02-23  
**Next Review**: 2026-03-23  
**Framework Owner**: Financial Analysis System
