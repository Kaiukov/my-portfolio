# HTML Table Formatting Guide

## Basic Structure

```html
<table>
  <tr>
    <th>Header 1</th>
    <th>Header 2</th>
    <th>Header 3</th>
  </tr>
  <tr>
    <td>Data 1</td>
    <td>Data 2</td>
    <td>Data 3</td>
  </tr>
</table>
```

**Key Rules:**
- `<th>` = header cells
- `<td>` = data cells
- `<tr>` = table row
- Each row must have equal column count

## Financial Data Patterns

### Pattern 1: Multi-Asset Comparison

```html
<table>
  <tr>
    <th>Asset</th>
    <th>Price</th>
    <th>24h Change</th>
    <th>Status</th>
  </tr>
  <tr>
    <td><strong>S&P 500</strong></td>
    <td>6,894</td>
    <td>+1.44%</td>
    <td>Rising</td>
  </tr>
  <tr>
    <td><strong>Bitcoin</strong></td>
    <td>$89,104</td>
    <td>-2.2%</td>
    <td>Declining</td>
  </tr>
  <tr>
    <td><strong>Gold</strong></td>
    <td>$4,514/oz</td>
    <td>+0.8%</td>
    <td>Stable</td>
  </tr>
</table>
```

### Pattern 2: Sector Performance

```html
<table>
  <tr>
    <th>Sector</th>
    <th>Movement</th>
    <th>Reason</th>
  </tr>
  <tr>
    <td>Technology</td>
    <td>+2.1%</td>
    <td>AI optimism continues</td>
  </tr>
  <tr>
    <td>Financials</td>
    <td>+1.3%</td>
    <td>Interest rate support</td>
  </tr>
</table>
```

### Pattern 3: Scenarios with Probability

```html
<table>
  <tr>
    <th>Scenario</th>
    <th>Probability</th>
    <th>S&P 500 Target</th>
    <th>Bitcoin Target</th>
  </tr>
  <tr>
    <td>Bullish</td>
    <td>40%</td>
    <td>+10–15%</td>
    <td>$120K–$150K</td>
  </tr>
  <tr>
    <td>Bearish</td>
    <td>35%</td>
    <td>-15–25%</td>
    <td>$50K–$70K</td>
  </tr>
  <tr>
    <td>Sideways</td>
    <td>25%</td>
    <td>6,700–7,100</td>
    <td>$80K–$95K</td>
  </tr>
</table>
```

## Formatting Best Practices

✅ **DO:**
- Use <strong> for metric names
- Right-align numbers (mentally or via visual hierarchy)
- Keep header labels clear and concise
- Use consistent units ($ for USD, % for percentages)

❌ **DON'T:**
- Leave empty cells (use "–" or "N/A")
- Mix currencies without labels ($, €, ₿)
- Add unrelated columns
- Use inline CSS or styles

## Common Patterns

### Macro Indicators

```html
<table>
  <tr>
    <th>Indicator</th>
    <th>Current</th>
    <th>Previous</th>
    <th>Status</th>
  </tr>
  <tr>
    <td>Unemployment</td>
    <td>4.4%</td>
    <td>4.5%</td>
    <td>✅ Improving</td>
  </tr>
  <tr>
    <td>CAPE Ratio</td>
    <td>40.3</td>
    <td>39.8</td>
    <td>⚠️ Elevated</td>
  </tr>
</table>
```

### Portfolio Allocation

```html
<table>
  <tr>
    <th>Asset Class</th>
    <th>Allocation</th>
    <th>Risk Level</th>
  </tr>
  <tr>
    <td><strong>Equities</strong></td>
    <td>60%</td>
    <td>High</td>
  </tr>
  <tr>
    <td><strong>Bonds</strong></td>
    <td>25%</td>
    <td>Medium</td>
  </tr>
  <tr>
    <td><strong>Gold</strong></td>
    <td>10%</td>
    <td>Low</td>
  </tr>
  <tr>
    <td><strong>Cash</strong></td>
    <td>5%</td>
    <td>Very Low</td>
  </tr>
</table>
```

## Checklist

- [ ] All rows have same column count
- [ ] <th> used for header row
- [ ] <td> used for data rows
- [ ] Header row is first <tr>
- [ ] Bold metric names with <strong>
- [ ] No empty cells (use "–" or "N/A")
- [ ] No CSS or style attributes
- [ ] Units consistent ($ for money, % for rates)
- [ ] Rows have logical grouping
