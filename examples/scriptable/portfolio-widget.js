// Variables used by widget:
//     widget – the ListWidget
//     args.widgetParameter – Scriptable external parameter (unused)
//     Script – Scriptable runtime
//     ListWidget, DrawContext, Path, Point, Rect, Size, Color, Font, Request, LinearGradient
// ═══════════════════════════════════════════════════
// Configurable URL – point this at your widget.json endpoint.
// The URL MUST NOT expose database credentials.
// ═══════════════════════════════════════════════════
const URL = "https://example.com/widget.json?token=CHANGE_ME"

const CFG = {
  bg: "#FFFFFF",
  textPrimary: "#1A1A1A",
  titleSize: 22,
  subtitleColor: "#8E8E93",
  subtitleSize: 13,
  valueSize: 40,
  labelGray: "#8E8E93",
  green: "#16A34A",
  red: "#DC2626",
  chartLineWidth: 3,
  padding: 16,
  errorColor: "#DC2626",
}

main()

// ═══════════ MAIN ═══════════

async function main() {
  try {
    const data = await fetchData()
    const widget = buildWidget(data)
    Script.setWidget(widget)
    Script.complete()
  } catch (err) {
    const widget = buildErrorWidget(err)
    Script.setWidget(widget)
    Script.complete()
  }
}

// ═══════════ DATA ═══════════

async function fetchData() {
  const req = new Request(URL)
  req.timeoutInterval = 15
  const data = await req.loadJSON()

  if (data.value == null) {
    throw new Error("widget.json missing field: value")
  }
  if (!data.title) {
    throw new Error("widget.json missing field: title")
  }

  return data
}

// ═══════════ WIDGET BUILDERS ═══════════

function buildWidget(data) {
  const widget = new ListWidget()
  widget.backgroundColor = new Color(CFG.bg)
  widget.setPadding(CFG.padding, CFG.padding, CFG.padding, CFG.padding)

  addTitle(widget, data.title)
  addSubtitle(widget, data.last_refresh)
  widget.addSpacer(6)
  addValue(widget, data.value, data.currency)
  widget.addSpacer(10)
  addBottomRow(widget, data)

  return widget
}

function buildErrorWidget(err) {
  const widget = new ListWidget()
  widget.backgroundColor = new Color(CFG.bg)
  widget.setPadding(CFG.padding, CFG.padding, CFG.padding, CFG.padding)

  const titleTxt = widget.addText("Portfolio")
  titleTxt.textColor = new Color(CFG.textPrimary)
  titleTxt.font = Font.boldSystemFont(CFG.titleSize)

  widget.addSpacer(6)

  const msg = widget.addText(err.message || "Could not load widget data")
  msg.textColor = new Color(CFG.errorColor)
  msg.font = Font.mediumSystemFont(13)

  widget.addSpacer(4)

  const hint = widget.addText("Check the URL in the script and your network connection.")
  hint.textColor = new Color(CFG.subtitleColor)
  hint.font = Font.systemFont(10)
  hint.lineLimit = 3

  return widget
}

// ═══════════ LAYOUT ROWS ═══════════

function addTitle(widget, title) {
  const t = widget.addText(title)
  t.textColor = new Color(CFG.textPrimary)
  t.font = Font.boldSystemFont(CFG.titleSize)
}

function addSubtitle(widget, lastRefresh) {
  const label = lastRefresh ? `Last refresh: ${relativeTime(lastRefresh)}` : "Last refresh: n/a"
  const s = widget.addText(label)
  s.textColor = new Color(CFG.subtitleColor)
  s.font = Font.systemFont(CFG.subtitleSize)
}

function addValue(widget, value, currency) {
  const v = widget.addText(formatMoney(value, currency))
  v.textColor = new Color(CFG.textPrimary)
  v.font = Font.boldSystemFont(CFG.valueSize)
  v.minimumScaleFactor = 0.7
}

function addBottomRow(widget, data) {
  const row = widget.addStack()
  row.layoutHorizontally()
  row.spacing = 8

  addMetricsStack(row, data.today, data.total, data.currency)
  row.addSpacer()
  addChart(row, data.series || [], data.today)
}

function addMetricsStack(parent, today, total, currency) {
  const stack = parent.addStack()
  stack.layoutVertically()
  stack.spacing = 4

  addMetricLine(stack, "Today", today, currency)
  addMetricLine(stack, "Total", total, currency)
}

function addMetricLine(stack, label, metric, currency) {
  const m = metric || { amount: 0, pct: 0 }
  const isPositive = m.amount >= 0
  const color = isPositive ? new Color(CFG.green) : new Color(CFG.red)

  const row = stack.addStack()
  row.layoutHorizontally()
  row.spacing = 4

  const labelTxt = row.addText(`${label} `)
  labelTxt.textColor = new Color(CFG.labelGray)
  labelTxt.font = Font.mediumSystemFont(13)

  const valueTxt = row.addText(`${formatSignedMoney(m.amount, currency)} (${formatPct(m.pct)})`)
  valueTxt.textColor = color
  valueTxt.font = Font.mediumSystemFont(13)
}

function addChart(parent, series, today) {
  const trendDown = today && today.amount != null ? today.amount < 0 : false
  const chart = drawChart(series, 160, 58, trendDown)
  const img = parent.addImage(chart)
  img.imageSize = new Size(160, 58)
}

// ═══════════ SPARKLINE ═══════════

function drawChart(series, width, height, trendDown) {
  const ctx = new DrawContext()
  ctx.size = new Size(width, height)
  ctx.opaque = false
  ctx.respectScreenScale = true

  if (!series || series.length < 2) {
    return ctx.getImage()
  }

  const values = series.map((x) => Number(x.value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const padH = 0
  const padV = 2
  const chartW = width - padH * 2
  const chartH = height - padV * 2

  const points = values.map((v, i) => {
    const x = padH + (values.length > 1 ? (i / (values.length - 1)) * chartW : chartW / 2)
    const y = padV + chartH - ((v - min) / range) * chartH
    return new Point(x, y)
  })

  const lineColor = trendDown ? new Color(CFG.red) : new Color(CFG.green)

  const fillPath = new Path()
  fillPath.move(new Point(points[0].x, height - padV))
  points.forEach((p) => fillPath.addLine(p))
  fillPath.addLine(new Point(points[points.length - 1].x, height - padV))
  fillPath.closeSubpath()

  const fillHex = trendDown ? CFG.red : CFG.green
  const baseline = height - padV

  // Faint solid base under the whole area (hides seams between the strips below).
  ctx.addPath(fillPath)
  ctx.setFillColor(new Color(fillHex, 0.05))
  ctx.fillPath()

  // Vertical gradient fade under the curve (dense near the line -> transparent at
  // the baseline), emulated with per-column strips. DrawContext.setFillColor takes
  // a Color, not a LinearGradient, so we layer thin rects to fake the gradient.
  const yAt = (px) => {
    if (px <= points[0].x) return points[0].y
    const last = points[points.length - 1]
    if (px >= last.x) return last.y
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      if (px >= a.x && px <= b.x) {
        const t = b.x === a.x ? 0 : (px - a.x) / (b.x - a.x)
        return a.y + t * (b.y - a.y)
      }
    }
    return last.y
  }
  const colW = 1
  const bands = 14
  const maxAlpha = 0.38
  for (let x = points[0].x; x <= points[points.length - 1].x; x += colW) {
    const yCurve = yAt(x)
    const stripH = baseline - yCurve
    if (stripH <= 0) continue
    for (let b = 0; b < bands; b++) {
      const yTop = yCurve + (stripH * b) / bands
      const bandH = stripH / bands + 0.8
      const alpha = maxAlpha * (1 - b / bands)
      ctx.setFillColor(new Color(fillHex, alpha))
      ctx.fillRect(new Rect(x, yTop, colW + 0.6, bandH))
    }
  }

  const linePath = new Path()
  points.forEach((p, i) => {
    if (i === 0) {
      linePath.move(p)
    } else {
      linePath.addLine(p)
    }
  })

  ctx.addPath(linePath)
  ctx.setStrokeColor(lineColor)
  ctx.setLineWidth(CFG.chartLineWidth)
  ctx.strokePath()

  return ctx.getImage()
}

// ═══════════ FORMATTERS ═══════════

function formatMoney(value, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatSignedMoney(value, currency) {
  const prefix = value >= 0 ? "+" : ""
  return prefix + formatMoney(value, currency)
}

function formatPct(value) {
  return `${Number(value).toFixed(2)}%`
}

function relativeTime(dateStr) {
  if (!dateStr) return "n/a"

  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "n/a"

  const now = new Date()
  let diff = Math.max(0, now - d)

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days >= 2) {
    const remHours = hours % 24
    if (remHours > 0) return `${days} days, ${remHours} hr ago`
    return `${days} days ago`
  }
  if (days === 1) {
    const remHours = hours % 24
    if (remHours > 0) return `1 day, ${remHours} hr ago`
    return "1 day ago"
  }
  if (hours >= 2) {
    const remMin = minutes % 60
    if (remMin > 0) return `${hours} hr, ${remMin} min ago`
    return `${hours} hr ago`
  }
  if (hours === 1) {
    const remMin = minutes % 60
    if (remMin > 0) return `1 hr, ${remMin} min ago`
    return "1 hr ago"
  }
  if (minutes >= 2) return `${minutes} min ago`
  if (minutes === 1) return "1 min ago"
  return "just now"
}
