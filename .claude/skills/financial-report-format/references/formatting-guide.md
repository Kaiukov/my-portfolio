# HTML Formatting Guide: Data Presentation & Attribution

## Rule 1: Numeric Data Presentation

**Pattern:** `<strong>Metric:</strong> Value (Context) | Explanation | Source`

```html
<!-- ✅ CORRECT -->
<p><strong>S&P 500:</strong> +1.44% (до 6,894 пунктов, +93 пункта за день)</p>
<p>Восстановление после геополитических угроз</p>
<p>Источник: <a href="https://www.cnbc.com/2026/01/21/">CNBC</a></p>

<!-- ❌ WRONG -->
<p>Markets up 1.44% today</p>
```

**Always include:**
- Percentage + Absolute value (for stocks/indices)
- Time period (24h, week, month)
- Context (reason, trigger, significance)
- Source URL

## Rule 2: Source Attribution

**Every factual claim needs attribution.**

```html
<!-- Inline source (preferred for critical data) -->
<p><strong>S&P 500:</strong> +1.44% (до 6,894 пунктов)</p>
<p>Восстановление на фоне отказа от тарифов</p>
<p>Источник: <a href="https://www.cnbc.com/2026/01/21/stock-market-today.html">CNBC - Market Today</a></p>

<!-- End-of-section source (if multiple related claims) -->
<p><strong>Daily Summary:</strong></p>
<ul>
  <li>S&P 500: +1.44%</li>
  <li>Dow: +1.3%</li>
  <li>Tech: +2.1%</li>
</ul>
<p>Источники: <a href="https://www.cnbc.com/">CNBC</a>, <a href="https://finance.yahoo.com/">Yahoo Finance</a></p>
```

## Rule 3: Text Styling

```html
<!-- Bold: Key metrics, danger signals, strong conclusions -->
<p><strong>S&P 500: +1.44%</strong> - main recovery indicator</p>

<!-- Italic: Caveats, disclaimers, clarifications -->
<p>Growth may be limited <em>if</em> geopolitical tensions resume</p>

<!-- Code: Specific terms, indicators -->
<p>The <code>CAPE Ratio</code> at 40.3 is critically elevated</p>
```

## Rule 4: Emoji Usage

**Primary (Section headers):**
```html
<h2>📊 I. Section Title</h2>        <!-- General analysis -->
<h2>📈 I. Market Recovery</h2>      <!-- Positive trend -->
<h2>📉 I. Market Decline</h2>       <!-- Negative trend -->
<h2>₿ II. Cryptocurrency</h2>       <!-- Crypto focus -->
<h2>💰 III. Macro Indicators</h2>   <!-- Financial data -->
```

**Inline (Within text):**
```html
<p>✅ Positive factor - use checkmark</p>
<p>❌ Risk factor or negative development</p>
<p>⚠️ Warning, requires attention</p>
<p>💡 Insight or observation</p>
<p>🎯 Strategic target or objective</p>
```

## Rule 5: Lists

```html
<!-- Bullet list for related items -->
<ul>
  <li>Supporting fact 1 with context</li>
  <li>Supporting fact 2 with context</li>
</ul>

<!-- Numbered list for sequential recommendations -->
<ol>
  <li><strong>Portfolio Rebalancing:</strong> Move 10-15% from stocks to protection</li>
  <li><strong>Risk Monitoring:</strong> Set triggers for market reassessment</li>
  <li><strong>Hedging Strategy:</strong> Trade volatility around events</li>
</ol>
```

## Rule 6: Data Hierarchy

### Level 1: Raw metric
```html
<p>S&P 500: +1.44%</p>
```

### Level 2: + Time period
```html
<p>S&P 500: +1.44% за 24 часа</p>
```

### Level 3: + Absolute value
```html
<p>S&P 500: +1.44% (до 6,894 пунктов)</p>
```

### Level 4: + Context
```html
<p><strong>S&P 500: +1.44%</strong> (до 6,894 пунктов) - восстановление после геополитических рисков</p>
```

### Level 5: + Source
```html
<p><strong>S&P 500: +1.44%</strong> (до 6,894 пунктов) - восстановление после отказа от тарифов</p>
<p>Источник: <a href="https://www.cnbc.com/2026/01/21/">CNBC</a></p>
```

**Use minimum Level 3-4 in professional reports.**

## Rule 7: Comparative Language

```html
<!-- ❌ Vague -->
<p>Market is strong</p>

<!-- ✅ Specific -->
<p><strong>S&P 500: +1.44%</strong>, outperforming 10-year average of +0.8%</p>
```

```html
<!-- ❌ Vague -->
<p>Gold at high levels</p>

<!-- ✅ Specific -->
<p><strong>Gold: $4,514/oz</strong> - 2nd all-time high after $4,600 record (Jan 15)</p>
```

## Rule 8: Tables

See **`references/table-formatting-guide.md`** for complete patterns.

Key rules:
- `<th>` for headers, `<td>` for data
- Bold metric names
- Consistent units ($, %, /oz)
- No empty cells

## Checklist

- [ ] Every numeric fact has source URL
- [ ] Percentages paired with absolute values
- [ ] Time period specified (24h, week, month)
- [ ] Key metrics in <strong>
- [ ] Emojis used consistently
- [ ] All links functional
- [ ] Italic for caveats/disclaimers
- [ ] Hierarchy clear (h1 → h2 → h3)
- [ ] No empty cells in tables
- [ ] Context provided, not standalone numbers
