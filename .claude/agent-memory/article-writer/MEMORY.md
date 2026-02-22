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

## Report 2026-02-22: Key Learnings

### Successfully Implemented
- **Structural transformation narrative** - Tariff asymmetry as central thesis (89.25% confidence ECB validation)
- **Asset class bifurcation clarity** - Precious metals/copper bullish vs oil/agriculture bearish structure
- **Ukraine reconstruction timing precision** - 6-9 month window before institutional acceleration (55-60% peace probability)
- **Professional light theme consistency** - Maintained Georgia serif, white background, institutional readability
- **Three-scenario framework refinement** - 25% optimistic / 50% realistic / 25% pessimistic (balanced uncertainty)
- **Portfolio allocation tables by risk profile** - Conservative 40/60, Growth 70/30, Aggressive opportunistic
- **Critical dates monitoring** - HANetf ETF launch (this week), EU Parliament vote, Q1 procurement orders

### Cross-Asset Correlation Patterns Identified
- **Tariff policy structural shift** - US multinationals disadvantaged vs international competitors (ECB Panetta confirmation)
- **Geographic divergence acceleration** - Europe (DAX +0.94%) outperforming US (S&P -0.24%) = capital rotation
- **Commodity bifurcation persistence** - Gold $4,703 (+72% YoY), Copper structural deficit 330k tons vs Oil surplus 3M bbl/d
- **Credit market stress emerging** - CLO retail flight, IG spreads 2nd percentile (78 bps OAS)
- **CAPE valuation extreme maintained** - 40.38 (135% above historical mean) = correction risk persists
- **Crypto consolidation without signals** - 0 high-confidence signals (88%+) = healthy market maturity

### Russian Language Quality Refinements
- **Title formula success** - "Структурная трансформация в условиях тарифной неопределенности" captures complexity
- **Technical precision** - Асимметричное повреждение (asymmetric damage), бифуркация (bifurcation), капитуляция (capitulation)
- **Action verbs clarity** - Накапливать (accumulate), недовес (underweight), избегать (avoid), следить (monitor)
- **Scenario headers** - Maintained Russian with probability badges for professional consistency

### File Organization
- Final saved to: `.claude/agent-memory/article-writer/INVEST/REPORTS/2026-02-22_Структурная_трансформация_в_условиях_тарифной_неопределенности.html`
- Title pattern: YYYY-MM-DD_DESCRIPTIVE_RUSSIAN_TITLE.html
- Consistent path: `INVEST/REPORTS/` subdirectory

### Key Data Integration Success
- **8 sub-agent synthesis** - Index (Feb 9), Stocks (Feb 22), Crypto (Feb 19), Commodities (Feb 19), Bonds (Feb 9), Macro (Feb 9), Big Investors (Feb 9), Ukraine (Feb 22)
- **High-confidence signals prioritization** - Only 88%+ signals featured (5 total: tariff asymmetry, USMCA risk, gold, oil bearish, copper bullish)
- **Ukraine reconstruction specificity** - $682B total, $67B energy, 60% capacity, HANetf ETF launch imminent
- **Macro red flags hierarchy** - CAPE 40.38 (highest priority), crypto divergence (2-4 week lead), labor deterioration

### Areas for Future Enhancement
- Consider adding visual charts for CAPE historical context (40.38 vs mean 17.3)
- Expand Ukraine reconstruction section if peace probability crosses 70% threshold
- Add specific entry/exit price levels for tactical commodity trades (gold $4,600 support, copper $5.50-5.70 accumulation)
- Create monitoring dashboard for critical dates (Feb 22-28 HANetf launch, Mar 1-15 procurement orders)

### Recurring Themes Across Reports
1. **Tariff policy structural impact** - NEW: Confirmed asymmetric damage to US corporations (ECB validation)
2. **CAPE valuation extreme persistence** - 40.38 maintained (was 40.01 Feb 19) = correction risk ongoing
3. **Crypto consolidation maturity** - 0 high-confidence signals = healthy lack of speculation
4. **Commodity bifurcation strengthening** - Gold/copper structural tailwinds vs oil/agriculture structural headwinds
5. **Ukraine ceasefire probability stable** - 55-60% maintained; Q1 procurement acceleration confirmed
6. **Fed policy trajectory** - 3.50-3.75% hold, 50 bps cuts expected 2026, PCE 3% confirmed

---
*Last Updated: 2026-02-22*
*Reports Generated: 2*
