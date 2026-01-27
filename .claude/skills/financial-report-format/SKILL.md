---
name: Financial Report Format
description: This skill should be used when the user asks to "write a financial report", "financial news format", "market analysis", "how to structure financial news", "report template", or needs guidance on formatting financial market updates with professional structure, data presentation, and analysis synthesis.
version: 1.0.2
---

# Financial Report Format Skill

This skill provides a structured methodology for writing professional financial reports, market analysis, and financial news with consistent formatting, hierarchical data presentation, and synthesized insights.

## Purpose

Financial reports require specific formatting to communicate market data, analysis, and actionable insights to investors, analysts, and financial professionals. This skill ensures reports follow a proven structure that balances data density with clarity, uses visual hierarchy effectively, and provides both granular details and strategic synthesis.

**Output Format:** All reports are generated as **professional HTML files** (plain HTML, NO CSS) for universal compatibility and direct browser viewing.

## When to Use This Skill

Activate this skill when:
- Writing daily/weekly market reports or financial news summaries
- Analyzing specific market sectors (crypto, equities, metals, bonds)
- Synthesizing multiple data sources into coherent financial narrative
- Structuring financial analysis for professional distribution
- Creating investment briefs or market updates
- Formatting financial data with proper contextualization

## Core Workflow

### Phase 1: Structure Planning

Identify the report scope:
1. **Report type**: Quick Daily (max 500 words) vs. Standard Daily (~1000 words) vs. Comprehensive report (3000-5000+ words)
2. **Data scope**: Single asset class vs. multi-asset synthesis
3. **Audience**: Investors, traders, analysts, or mixed professional audience
4. **Time horizon**: Short-term tactics vs. long-term strategy implications

Determine section count:
- Quick: 2-3 sections (tight focus)
- Standard: 4-5 sections (balanced coverage)
- Comprehensive: 6-8+ sections

### Phase 2: Header/Metadata

Every report begins with:
```html
<h1>📊 [EMOJI] REPORT TITLE</h1>
<h2>"[Single-line thesis statement]"</h2>

<p><strong>Дата подготовки:</strong> DD Month YYYY</p>
<p><strong>Период анализа:</strong> DD-DD Month YYYY</p>
<p><strong>Аналитик:</strong> [Name or role]</p>
```

**Emoji selection** signals report focus:
- `📊` General reports, multi-asset
- `📈` Positive trends, recovery narratives
- `📉` Decline narratives, risk warnings
- `₿` Cryptocurrency focus
- `💰` Financial/economic indicators
- `🏆` Outperformance, achievements

### Phase 3: Section Structure (HTML)

Each report section follows HTML formatting:

```html
<h2>📈 I. SECTION TITLE</h2>

<h3>Data Point or Subsection</h3>
<p><strong>Key Metric:</strong> Value (Change%) - context</p>

<ul>
  <li>Supporting fact 1</li>
  <li>Supporting fact 2</li>
</ul>

<p>Источник: <a href="https://source-url">CNBC</a></p>

<h3>Another Key Point</h3>
<p><strong>Metric 1:</strong> Value with context</p>
<p><strong>Metric 2:</strong> Value with context</p>

<p>Источник: <a href="https://source-url">Source Name</a></p>

<h3>🔍 Ключевая интерпретация</h3>
<p>[3-5 sentences explaining WHY this matters + practical implications]</p>
```

**Section requirements:**
- Use <code>&lt;h2&gt;</code> for main section (with Roman numeral + emoji)
- Use <code>&lt;h3&gt;</code> for subsections
- Use <code>&lt;strong&gt;text&lt;/strong&gt;</code> for bold metrics and numbers
- Use <code>&lt;ul&gt;&lt;li&gt;</code> for bullet points
- Use <code>&lt;a href="URL"&gt;text&lt;/a&gt;</code> for source links
- End each section with interpretation (<code>&lt;h3&gt;</code>: "Ключевая интерпретация")

### Phase 4: Data Presentation Rules

**Numeric format in HTML:**
```html
<p><strong>S&P 500:</strong> +1.44% (до 6,894 пунктов)</p>
<p>Context: Recovery after geopolitical threats</p>
```
- Always show: percentage AND absolute value
- Include context in separate paragraph

**HTML table format:**
```html
<table>
  <tr>
    <th>Категория</th>
    <th>Движение</th>
    <th>Интерпретация</th>
  </tr>
  <tr>
    <td><strong>S&P 500</strong></td>
    <td>+1.44%</td>
    <td>Восстановление</td>
  </tr>
  <tr>
    <td><strong>Bitcoin</strong></td>
    <td>-2.2%</td>
    <td>Коррекция</td>
  </tr>
</table>
```

**Source attribution (required for every fact):**
```html
<p>Источник: <a href="https://www.cnbc.com/2026/01/19/...">CNBC</a></p>
```

### Phase 5: Synthesis Section (HTML)

Create aggregation section with tables and lists:

```html
<h2>📊 VI. СИНТЕЗ И КЛЮЧЕВЫЕ ДВИЖЕНИЯ</h2>

<table>
  <tr>
    <th>Актив / Индекс</th>
    <th>Движение</th>
    <th>Интерпретация</th>
  </tr>
  <tr>
    <td><strong>S&P 500</strong></td>
    <td>+1.44%</td>
    <td>Восстановление</td>
  </tr>
  <tr>
    <td><strong>Bitcoin</strong></td>
    <td>-2.2%</td>
    <td>Коррекция</td>
  </tr>
</table>

<h3>Ключевые паттерны:</h3>
<ul>
  <li>Pattern 1 with context</li>
  <li>Pattern 2 with context</li>
</ul>

<h3>Оценка рисков и возможностей:</h3>
<p><strong>✅ Positive factors:</strong></p>
<ul>
  <li>Factor 1</li>
  <li>Factor 2</li>
</ul>

<p><strong>❌ Negative factors:</strong></p>
<ul>
  <li>Risk 1</li>
  <li>Risk 2</li>
</ul>
```

### Phase 6: Scenarios & Recommendations (HTML)

```html
<h2>🎯 VII. СЦЕНАРИИ И РЕКОМЕНДАЦИИ</h2>

<h3>📈 Бычий сценарий (40% вероятность)</h3>
<ul>
  <li>Условие 1 → Результат A</li>
  <li>Условие 2 → Результат B</li>
</ul>
<p><strong>Ожидаемый исход:</strong> +15% рост</p>

<h3>📉 Медвежий сценарий (35% вероятность)</h3>
<ul>
  <li>Риск 1 → Падение C</li>
  <li>Риск 2 → Падение D</li>
</ul>
<p><strong>Ожидаемый исход:</strong> -20% коррекция</p>

<h3>➡️ Боковой сценарий (25% вероятность)</h3>
<p>Диапазонная торговля без явной направленности</p>

<h3>Рекомендации:</h3>
<ol>
  <li><strong>Решение:</strong> Обоснование + ожидаемый результат</li>
  <li><strong>Позиционирование:</strong> Конкретное руководство по портфелю</li>
  <li><strong>Управление рисками:</strong> Защитные меры</li>
</ol>
```

### Phase 7: Footer (HTML)

```html
<hr>

<h2>🔍 МЕТОДОЛОГИЯ И ИСТОЧНИКИ</h2>

<p>Этот отчет основан на анализе данных с:</p>

<ul>
  <li><a href="https://www.cnbc.com">CNBC</a></li>
  <li><a href="https://www.bloomberg.com">Bloomberg</a></li>
  <li><a href="https://coindesk.com">CoinDesk</a> (если крипто)</li>
  <li><a href="https://www.bls.gov">U.S. Bureau of Labor Statistics</a></li>
</ul>

<p>Все цифры получены из официальных источников.</p>

<hr>

<p><strong>Подготовлен:</strong> DD Month YYYY</p>
<p><strong>Территория покрытия:</strong> Global Markets</p>
<p><strong>Целевая аудитория:</strong> Investors / Traders / Analysts</p>

<p><em>Отчет предназначен для информационных целей. Не является инвестиционным советом.</em></p>
```

### Phase 8: Final HTML Output

**File naming convention:** `{yyyymmdd}-{название-на-русском}.html`

**Rules:**
- Date format: `yyyymmdd` (e.g., `20260122`)
- Separator: hyphen `-`
- **Document name: Russian only, lowercase, hyphens between words**
- Extension: `.html`

**Examples:**
- `20260122-восстановление-акции-геополитика.html` (Market recovery + geopolitics)
- `20260121-коррекция-крипто-ликвидации.html` (Crypto correction + liquidations)
- `20260120-макро-безработица-cape-риск.html` (Macro indicators + recession risk)
- `20260119-синтез-недели-тренды-риски.html` (Weekly synthesis - trends & risks)
- `20260118-сценарии-фед-инфляция-ставки.html` (Fed scenarios - rates & inflation)

**Best practices for Russian naming:**
- ✅ Use hyphens between words: `восстановление-рынка-акции`
- ✅ Use lowercase only: `восстановление` (not `Восстановление`)
- ✅ Be descriptive: 4-5 words max
- ✅ Only Russian letters, numbers, hyphens: `20260122-название-файла.html`

**Final checklist before saving:**
- [ ] All external links use HTML format: `<a href="URL">text</a>`
- [ ] Headers use proper HTML syntax (<h1>, <h2>, <h3>)
- [ ] Bold text uses <strong>text</strong> format
- [ ] File size < 300KB
- [ ] Renders correctly in web browsers
- [ ] File name: `{yyyymmdd}-{название-на-русском}.html`

## Quality Standards

- **Data Precision:** Every number has context + source URL
- **Percentage + Absolute:** Always show both: +1.44% (до 6,894 пунктов)
- **Interpretation:** Each metric section ends with "Why does this matter?"
- **Objectivity:** Show both risks (❌) and opportunities (✅)
- **Tone:** Professional, specific, no marketing language
- **Sources:** Use only institutional sources (see `references/source.md` for avoid list)

## Pre-Publication Checklist

**Content:**
- [ ] H1: emoji + title + thesis on first line
- [ ] Date and metadata in opening paragraph
- [ ] All metrics have source URLs linked
- [ ] Each section ends with interpretation paragraph
- [ ] Risk/opportunity assessment included in synthesis section
- [ ] Scenarios: 3 with probability % totaling ~100%
- [ ] Recommendations: 2-3, numbered and actionable
- [ ] Footer: sources with links + disclaimer

**HTML Structure:**
- [ ] Headers use proper HTML syntax (<h1>, <h2>, <h3>)
- [ ] All links: `<a href="URL">text</a>`
- [ ] Tables use proper HTML format (<table>, <tr>, <th>, <td>)
- [ ] Bold text: `<strong>text</strong>`
- [ ] Proper heading hierarchy: <h1> (title) → <h2> (sections) → <h3> (subsections)

**File & Performance:**
- [ ] File name: `{yyyymmdd}-{название-на-русском}.html`
- [ ] File size < 300KB
- [ ] No special characters in filename (only letters, numbers, hyphens)
- [ ] Tested in web browser
- [ ] No broken links or missing resources

## Report Sizing Guide

**Быстрый дневной:** 2-3 секции, max 500 слов, <50KB, пример: `20260122-акции-восстановление.html`

**Стандартный дневной:** 4-5 секций, ~1000 слов, 50-100KB, пример: `20260122-синтез-риски-возможности.html`

**Еженедельный:** 6-8 секций, 3000-5000 слов, 150-250KB, пример: `20260122-неделя-крипто-макро.html`

**Комплексный анализ:** 8-10+ секций, 5000+ слов, 250-400KB, пример: `20260122-стратегический-обзор-рынков.html`

## Additional Resources

### Reference Files
For detailed section templates, data presentation formats, and best-practice examples:
- **`references/vocabulary.md`** - Financial terms with ultra-simple explanations
- **`references/section-templates.md`** - HTML section templates with examples
- **`references/formatting-guide.md`** - HTML data presentation, tables, attribution rules
- **`references/table-formatting-guide.md`** - Complete HTML table formatting with patterns
- **`references/best-practices.md`** - Tone, language, critical analysis patterns
- **`references/how-to-html.md`** - HTML semantics guide (<h1>-<h3>, <strong>, <table>, <ul>)
- **`references/source.md`** - Sources to avoid 

### Example Reports
Working HTML examples in `examples/`:
- **`sample-market-report.html`** - Complete 7-section HTML market analysis report
- **`initial-prompt-example.html`** - Initial news research HTML template 

## Writing Style

### Imperative Form
Structure sections with action-oriented language:

✅ "Identify key resistance levels"
✅ "Analyze sector rotation patterns"
✗ "You should look at resistance levels"
✗ "The user can analyze patterns"

### Objectivity
Present balanced view:

✅ "CAPE Ratio at 40.3 indicates 135% premium to historical average;
    historically leads to 10-year underperformance"
✗ "Market is overvalued and will crash"

### Source Attribution
Essential for credibility:
```html
✅ Metric + source: <p><strong>Bitcoin:</strong> $89,104 (-2.2% in 24h) <a href="https://coindesk.com">взято из CoinDesk</a></p>
✗ Unsourced claims: "Bitcoin fell due to market weakness"
```

## Common Mistakes to Avoid

❌ **Unsourced claims** - Every fact needs attribution
❌ **Vague interpretations** - Always explain significance
❌ **Missing context** - Raw numbers without background
❌ **Unbalanced view** - Show both opportunities and risks
❌ **Mismatched emoji** - Ensure visual signaling matches content
❌ **Incomplete scenarios** - Missing probability percentages
❌ **No actionable recommendations** - Reports must inform decisions

## Implementation Steps

**Step 1: Define Scope**
- Report type: Quick Daily (500 words) | Standard Daily (1000 words) | Comprehensive (3000-5000+ words)
- Asset classes: Single vs. Multi-asset
- Audience: Investors | Traders | Analysts

**Step 2: Gather Data**
- Collect from 3-5 authoritative sources (CNBC, Bloomberg, CoinDesk, etc.)
- Track URLs for every metric
- Note dates and times for data freshness

**Step 3: Create HTML Structure**
- Use HTML template from `references/how-to-html.md`
- Add header with emoji, title, thesis, date metadata
- Create empty section headers (I-VIII)

**Step 4: Write Sections**
- Per section: 2-4 subsections with data + source + interpretation
- Format all metrics in <strong>bold</strong> using <code>&lt;strong&gt;text&lt;/strong&gt;</code>
- Use HTML tables for comparisons
- Always cite source URLs in <code>&lt;a href="URL"&gt;text&lt;/a&gt;</code> format

**Step 5: Add Synthesis**
- Section VII: Summary table of key movements
- Identify cross-market patterns
- List risks (❌) and opportunities (✅)

**Step 6: Add Scenarios**
- Section VIII: 3 scenarios with probability %
- Include conditions and expected outcomes
- Add 2-3 actionable recommendations

**Step 7: Add Footer**
- List all data sources with links
- Add metadata (date, coverage, audience)
- Include disclaimer

**Step 8: Validate & Save**
- Check all links work properly
- Verify HTML formatting is valid
- Test in web browser
- **Save as:** `{yyyymmdd}-{название-на-русском}.html`
  - Example: `20260122-восстановление-рынка-акции.html`
  - Lowercase Russian words with hyphens, NOT underscores
- Save HTML file to `reports/` folder locally

---

## HTML Format Specifications (NO CSS)

All financial reports are generated as **pure HTML** with no external CSS or styling frameworks. This ensures:
- ✅ Universal browser compatibility
- ✅ Maximum portability across platforms
- ✅ Direct viewing without dependencies
- ✅ Professional semantic HTML markup (<h1>, <h2>, <table>, <ul>, <strong>, etc.)
- ✅ Clean structure for easy parsing

**Minimal HTML Template:**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Financial Report - [Date]</title>
</head>
<body>
  <h1>📊 REPORT TITLE</h1>
  <h2>"Thesis Statement"</h2>
  <!-- Report content using semantic HTML tags -->
</body>
</html>
```

This structure ensures professional financial reporting that balances data precision with strategic insight, enabling informed decision-making by finance professionals using plain HTML accessibility.
