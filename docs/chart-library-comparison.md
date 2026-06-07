# Chart library comparison

Comparison of five JavaScript/TypeScript charting libraries evaluated for use in the portfolio dashboard, which is a vanilla single-file HTML/JS SPA (no React, no build step).

## Comparison

| Library | Rendering | Best for | TS out of box |
|---|---|---|---|
| **Recharts** | SVG | React projects | Yes |
| **Chart.js** | Canvas | Lightweight dashboards | Yes (`@types/chart.js`) |
| **ECharts** | Canvas / SVG | Large datasets, interactive | Yes |
| **ApexCharts** | SVG | Beautiful charts with minimal config | Yes (`@types/apexcharts`) |
| **D3.js** | SVG | Custom unique visualizations | Yes (`@types/d3`) |

## Details

- **Recharts** — declarative React library, beautiful animations out of the box. Optimal choice for React + TypeScript.
- **Chart.js** — classic canvas library, high performance, has `react-chartjs-2` wrapper.
- **ECharts** (Apache) — powerful tool for large datasets and interactive dashboards.
- **ApexCharts** — modern visuals, responsive without complex setup, PNG/SVG export.
- **D3.js** — low-level SVG control for unique custom visualizations.

## Recommendation for my-portfolio

The portfolio dashboard (`portfolio-dashboard/index.html`) is a single-file vanilla HTML/JS SPA served by a Cloudflare Worker. It has no React, no build step, no package.json. The only chart it currently renders is a hand-rolled SVG sparkline (value-over-time area chart built via raw `<path>` string concatenation in ~25 lines of inline script).

Given these constraints:

| Library | Viable? | Notes |
|---|---|---|
| **Recharts** | **No** | React-only; would require migrating the entire dashboard to a React build pipeline. Out of scope. |
| **Chart.js** | **Yes** | CDN `<script src="https://cdn.jsdelivr.net/npm/chart.js">` or ES module import. Canvas-based, good perf. Adds ~250 KB (gzipped ~70 KB) dependency to a currently dependency-free file. |
| **ApexCharts** | **Yes** | CDN build available. SVG-based (easy to style). Adds ~300 KB dependency. |
| **ECharts** | **Yes** | CDN build. Powerful but heavy (~1 MB). Overkill for the current simple charting needs. |
| **D3.js** | **Yes** | CDN build. Low-level, steep learning curve. Closest to the current hand-rolled approach but orders of magnitude more flexible. Adds ~250 KB. |
| **Stay with hand-rolled SVG** | **Already works** | Zero dependencies. Current implementation is ~25 lines. Adding new chart types (pie, bar, histogram) would require manual SVG math each time. |

**Recommendation: stay with hand-rolled SVG for now.** The dashboard's single chart (value-over-time area sparkline) is adequately served by the existing ~25-line SVG renderer. If richer charting is needed later (allocation pie charts, performance histogram, sector breakdown), the easiest first step would be **Chart.js** via CDN (smallest footprint, excellent canvas perf, no build step). Recharts is not viable without a React migration, which is a significantly larger effort than the charting problem justifies.

## Source

Research originated in GitHub issue [#275](https://github.com/Kaiukov/my-portfolio/issues/275).
