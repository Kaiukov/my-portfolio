# HTML Guide for Financial Reports

Minimal HTML5 semantic markup (NO CSS).

## Document Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Financial Report - [Date]</title>
</head>
<body>
  <!-- Content here -->
</body>
</html>
```

## Headers

```html
<h1>📊 Main Report Title</h1>
<h2>📈 I. Section Title</h2>
<h3>Subsection Title</h3>
<h4>Detail Level</h4>
```

## Text Formatting

```html
<!-- Bold -->
<strong>S&P 500: +1.44%</strong>

<!-- Italic -->
<em>if conditions remain stable</em>

<!-- Code/Monospace -->
<code>CAPE Ratio</code>

<!-- Paragraph -->
<p>Main text content goes here</p>

<!-- Line break (if needed) -->
<br>
```

## Lists

```html
<!-- Unordered -->
<ul>
  <li>Supporting fact 1</li>
  <li>Supporting fact 2</li>
</ul>

<!-- Ordered -->
<ol>
  <li>First recommendation</li>
  <li>Second recommendation</li>
</ol>
```

## Links

```html
<a href="https://www.cnbc.com/2026/01/22/">CNBC Article</a>

<!-- In context -->
<p>Источник: <a href="https://www.cnbc.com/2026/01/22/">CNBC</a></p>
```

## Tables

```html
<table>
  <tr>
    <th>Актив</th>
    <th>Движение</th>
    <th>Контекст</th>
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

## Horizontal Line

```html
<hr>
```

## Combined Example

```html
<h2>📈 I. Market Overview</h2>

<h3>Key Metrics</h3>

<p><strong>S&P 500:</strong> +1.44% (до 6,894 пунктов)</p>
<p>Recovery after geopolitical threats</p>

<ul>
  <li>Tech sector leads: Intel +7%</li>
  <li>Financials support: Banks +1.3%</li>
</ul>

<p>Источник: <a href="https://www.cnbc.com/">CNBC</a></p>

<h3>🔍 Ключевая интерпретация</h3>
<p>[Analysis paragraph]</p>
```

## Checklist

- ✓ Use semantic HTML tags (<strong>, <em>, <table>, <ul>)
- ✓ All links use <a href="URL">text</a>
- ✓ No <br> for spacing (use <p> instead)
- ✓ Tables have <th> headers
- ✓ Proper heading hierarchy (h1 → h2 → h3)
- ✓ NO CSS, NO style attributes
