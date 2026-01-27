# Markdown Guide for Financial Reports

This guide provides the essential Markdown formatting rules required for creating professional financial reports.

## Headers

Use ATX-style headers with proper hierarchy:

```markdown
# Main Title (H1)
## Section Title (H2)
### Subsection Title (H3)
```

For financial reports specifically:
```markdown
# 📊 Market Analysis Report Title
## 📈 I. Market Overview
### Key Metrics Today
```

## Bold and Emphasis

Use double asterisks for bold text, especially for metrics:
```markdown
**S&P 500:** +1.44% (до 6,894 пунктов)
**Key indicator:** Value with context
```

## Lists

### Unordered Lists
Use hyphens for bullet points:
```markdown
- Supporting fact 1
- Supporting fact 2
- Supporting fact 3
```

### Ordered Lists
Use numbers for sequential steps:
```markdown
1. First recommendation
2. Second recommendation
3. Third recommendation
```

## Links

Always use the [text](URL) format for source attribution:
```markdown
Источник: [CNBC Article Title](https://www.cnbc.com/2026/01/22/article-link.html)
```

For financial reports, always attribute every data point:
```markdown
Bitcoin reached $89,104 (-2.2% in 24h) [data from Coindesk](https://coindesk.com/bitcoin-price)
```

## Tables

**⚠️ Important:** See **`references/table-formatting-guide.md`** for comprehensive table formatting rules, pipe escaping, and common mistakes.

Basic template:
```markdown
| Актив / Индекс | Движение | Интерпретация |
|----------------|----------|---------------|
| **S&P 500**    | +1.44%   | Восстановление |
| **Bitcoin**    | -2.2%    | Коррекция     |
| **Gold**       | +0.8%    | Безопасный актив |
```

Quick rules: Use **bold** for metrics • Right-align numbers • One space inside pipes • Never use unescaped pipes in cell content

## Line Breaks

Force line breaks by ending a line with two spaces:
```markdown
**Metric 1:** Value with context  
**Metric 2:** Value with context
```

## Combining Elements

Financial reports typically combine these elements:

```markdown
## 📈 I. Market Overview

**S&P 500:** +1.44% (до 6,894 пунктов)  
**NASDAQ:** +2.11% (до 18,450 пунктов)

### Key Developments:
- Fed policy expectations shifted
- Geopolitical tensions eased
- Energy prices stabilized

Источник: [Market Analysis](https://www.bloomberg.com/markets)

### 🔍 Ключевая интерпретация
[3-5 sentences explaining WHY this matters + practical implications]
```

## Financial-Specific Conventions

- Always pair percentages with absolute values: `**S&P 500:** +1.44% (до 6,894 пунктов)`
- Use bold for all key metrics and asset names
- Include source attribution for every claim/fact
- Use emojis consistently at the beginning of section headers
- Maintain the H2 (##) for main sections format: `## 📈 I. Section Title`
- Use H3 (###) for subsections within sections

## Checklist for Valid Markdown

- [ ] All headers use # ## ### syntax (no underline-style headers)
- [ ] Bold text uses **asterisks** (not __underscores__)
- [ ] Tables have proper pipe separators and header rows
- [ ] All links use [text](URL) format
- [ ] Line breaks between metric pairs use two spaces at end of line
- [ ] No HTML tags (no <b>, <p>, <div>, etc.)
- [ ] Consistent spacing around Markdown elements