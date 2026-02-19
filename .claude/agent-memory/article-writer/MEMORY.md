# Article Writer Agent Memory

## Report Format Patterns

### HTML Financial Report Structure (Proven)
- Dark theme design system with CSS variables (--color-bg: #0d1117 GitHub-style dark)
- Sections: Masthead > Risk Banner > Executive Summary > Regime Bar > 8 Asset Sections > Recommendations Table > Scenario Cards > Risk Profile > Conclusion > Methodology > Footer
- Section numbering in Russian: I. Индексы, II. Акции, III. Крипто, IV. Сырьё, V. Облигации, VI. Украина, VII. Крупные инвесторы, VIII. Макро, IX. Рекомендации, X. Сценарии, XI. Профиль риска
- Confidence bars (visual fill bars 0-100%) work well for signal tables
- Scenario cards: three-column grid, color-coded (green/gold/red), probability bars

### Color Coding Convention
- Green (#3fb950): positive/bullish/overweight/accumulate
- Gold (#d29922): neutral/watch/selective/macro signals
- Red (#f85149): negative/bearish/avoid/underweight/warnings
- Blue (#388bfd): structural/long-term signals, treasury data
- Orange (#d4800a): monitor/cautious

### Badge/Tag System
- rec-tag classes: overweight, accumulate, hold, selective, neutral, underweight, avoid, speculative, monitor
- regime-badge classes: risk-off, neutral, risk-on, warning, structural, positive, hold

### Key Russian Financial Terms
- Overweight = Overweight (keep English for professional reports)
- Риск-офф / Риск-он = Risk-Off / Risk-On
- Уверенность = Confidence
- Сценарный анализ = Scenario Analysis
- Сохранение капитала = Capital Preservation

## File Naming
- Pattern: FINANCIAL_REPORT_YYYY-MM-DD.html
- Save to: /home/kaiukov/my-portfolio/ (project root for direct access)
- raw_article inputs: /home/kaiukov/my-portfolio/raw_article_YYYY-MM-DD.md

## Agent Count
- 8 sub-agents total: index-analyst, market-signal-analyzer, crypto-signal-analyzer, commodities-signal-analyzer, bonds-treasury-signal-analyzer, macro-financial-strategist, ukraine-signal-analyzer, big-investor-signal-analyzer

## Quality Checks
- Always verify HTML closes all tags (no unclosed divs)
- Ensure all tables have thead/tbody
- Probability bars in scenario cards use inline width% style on .fill div
- Risk banner at top of page inside masthead wrapper
- Methodology section explains the 3-filter system (Economic Moat, Macro/Structural, Value vs Price) with 88%+ threshold

## Report 2026-02-19: Key Learnings

### Successfully Implemented
- **Light theme professional report** - Clean white background, traditional serif fonts, institutional readability
- **CAPE + Crypto Fear divergence** as central thesis (40.01 CAPE + Fear Index 9) - compelling narrative anchor
- **Geographic divergence framework** - DAX/FTSE strength vs S&P 500 weakness = rotation not crash
- **Critical red flags section** - Prioritized valuation disconnect, crypto capitulation leading indicator, labor warnings
- **Ukraine reconstruction integration** - Maintained as separate high-conviction opportunity (92% avg confidence)
- **Commodity bifurcation clarity** - Gold/Copper accumulate vs Oil/Agriculture avoid
- **Three-scenario probabilities** - 25% optimistic / 55% realistic / 20% pessimistic (reflects genuine uncertainty)
- **Conclusion action checklist** - Specific monitoring dates and metrics (Feb 23 - Mar 9 high-risk window)

### Cross-Asset Correlation Patterns Worth Repeating
- Crypto Fear Index as 2-6 week equity leading indicator (75% historical accuracy)
- CAPE above 40 + neutral equity sentiment = elevated correction risk (80% probability)
- Labor market deterioration (108K January cuts) → Fed pause extension → duration opportunity
- China de-dollarization acceleration → Treasury duration risk + geopolitical commodity premium
- AI CapEx cycle ($527B) as singular pillar supporting current valuations

### Russian Language Quality Notes
- Professional financial terminology maintained throughout
- Avoided machine translation artifacts
- Consistent use of terms: достоверность (confidence), аллокация (allocation), перевес/недовес (overweight/underweight)
- Scenario headers in Russian with English probability labels worked well

### File Organization Success
- Draft saved to: `.claude/agent-memory/article-writer/REPORT_2026-02-19_draft.html`
- Final saved to: `.claude/agent-memory/article-writer/INVEST/REPORTS/2026-02-19_Критическая_точка_перелома.html`
- Input processed from: `/home/kaiukov/my-portfolio/raw_article_2026-02-19.md`

### Areas for Future Enhancement
- Add specific entry/exit price levels for tactical trades (currently qualitative)
- Include historical CAPE percentile charts/context for valuation extremes
- Expand crypto section when high-confidence signals exist (this report had 0/10 qualified signals)
- Create monitoring timeline visual for key dates (Nvidia earnings Feb 25, Powell exit May 15)
- Consider adding portfolio allocation examples for ultra-conservative (<30% equity) profiles

### Recurring Themes to Track Across Reports
1. **AI CapEx sustainability** - Core support pillar, monitor quarterly CapEx guidance
2. **Fed leadership transition** - Powell exit May 15, 2026 creates policy uncertainty
3. **China de-dollarization** - Treasury holdings reduction ongoing structural shift
4. **Labor market deterioration** - Leading recession indicator (108K Jan cuts = 2008 levels)
5. **Ukraine ceasefire probability** - Currently 55-60%, impacts $682B reconstruction timeline
6. **CAPE mean reversion risk** - 40.01 current vs 17.5 historical mean (131% premium)

---
*Last Updated: 2026-02-19*
*Reports Generated: 1*
