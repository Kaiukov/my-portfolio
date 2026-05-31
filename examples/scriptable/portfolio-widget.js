// Variables used by widget:
//     widget – the ListWidget
//     args.widgetParameter – Scriptable external parameter (unused)
//     Script – Scriptable runtime
//     ListWidget, DrawContext, Path, Point, Size, Color, Font, Request, LinearGradient
//     config – colour + dimensions tuning
// ═══════════════════════════════════════════════════
// Configurable URL – point this at your widget.json endpoint.
// The URL MUST NOT expose database credentials.
// ═══════════════════════════════════════════════════
const URL = "https://example.com/widget.json?token=CHANGE_ME"

const DATA_KEY = "portfolio_widget_cache"

const CFG = {
  bg: "#111111",
  titleColor: "#a1a1aa",
  titleSize: 12,
  valueColor: "#ffffff",
  valueSize: 28,
  separatorColor: "#27272a",
  green: "#22c55e",
  red: "#ef4444",
  footerColor: "#71717a",
  footerSize: 9,
  chartLineWidth: 2.5,
  chartPaddingH: 2,
  chartPaddingV: 4,
  errorColor: "#f87171",
  padding: 14,
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
  addValue(widget, data.value, data.currency)
  addSeparator(widget)
  addTodayLine(widget, data.today)
  addTotalLine(widget, data.total)
  addChart(widget, data.series || [], data.total)
  addFooter(widget, data.last_refresh)

  return widget
}

function buildErrorWidget(err) {
  const widget = new ListWidget()
  widget.backgroundColor = new Color(CFG.bg)
  widget.setPadding(CFG.padding, CFG.padding, CFG.padding, CFG.padding)

  const icon = widget.addText("Portfolio")
  icon.textColor = new Color(CFG.titleColor)
  icon.font = Font.mediumSystemFont(CFG.titleSize)

  widget.addSpacer(6)

  const msg = widget.addText(err.message || "Could not load widget data")
  msg.textColor = new Color(CFG.errorColor)
  msg.font = Font.mediumSystemFont(12)

  widget.addSpacer(4)

  const hint = widget.addText("Check the URL in the script and your network connection.")
  hint.textColor = new Color(CFG.footerColor)
  hint.font = Font.systemFont(9)
  hint.lineLimit = 3

  return widget
}

// ═══════════ ROW HELPERS ═══════════

function addTitle(widget, title) {
  const t = widget.addText(title)
  t.textColor = new Color(CFG.titleColor)
  t.font = Font.mediumSystemFont(CFG.titleSize)
}

function addValue(widget, value, currency) {
  widget.addSpacer(6)
  const v = widget.addText(formatMoney(value, currency))
  v.textColor = new Color(CFG.valueColor)
  v.font = Font.boldSystemFont(CFG.valueSize)
  v.minimumScaleFactor = 0.7
}

function addSeparator(widget) {
  widget.addSpacer(8)
  const stack = widget.addStack()
  stack.size = new Size(0, 1)
  stack.backgroundColor = new Color(CFG.separatorColor)
  widget.addSpacer(6)
}

function addTodayLine(widget, today) {
  const t = today || { amount: 0, pct: 0 }
  const line = widget.addText(
    `Today ${formatSignedMoney(t.amount, t.currency || "USD")} (${formatSignedPct(t.pct)})`
  )
  line.textColor = t.amount >= 0 ? new Color(CFG.green) : new Color(CFG.red)
  line.font = Font.mediumSystemFont(13)
}

function addTotalLine(widget, total) {
  const t = total || { amount: 0, pct: 0 }
  const line = widget.addText(
    `Total ${formatSignedMoney(t.amount, t.currency || "USD")} (${formatSignedPct(t.pct)})`
  )
  line.textColor = t.amount >= 0 ? new Color(CFG.green) : new Color(CFG.red)
  line.font = Font.mediumSystemFont(13)
}

function addChart(widget, series, total) {
  widget.addSpacer(8)

  const positive = (total && total.amount != null) ? total.amount >= 0 : true
  const chart = drawChart(series, 300, 72, positive)
  const img = widget.addImage(chart)
  img.imageSize = new Size(300, 72)
}

function addFooter(widget, lastRefresh) {
  widget.addSpacer(6)
  const f = widget.addText(`Updated ${shortDate(lastRefresh)}`)
  f.textColor = new Color(CFG.footerColor)
  f.font = Font.systemFont(CFG.footerSize)
}

// ═══════════ SPARKLINE ═══════════

function drawChart(series, width, height, positive) {
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

  const padH = CFG.chartPaddingH
  const padV = CFG.chartPaddingV
  const chartW = width - padH * 2
  const chartH = height - padV * 2

  const points = values.map((v, i) => {
    const x = padH + (values.length > 1 ? (i / (values.length - 1)) * chartW : chartW / 2)
    const y = padV + chartH - ((v - min) / range) * chartH
    return new Point(x, y)
  })

  const linePath = new Path()
  points.forEach((p, i) => {
    if (i === 0) {
      linePath.move(p)
    } else {
      linePath.addLine(p)
    }
  })

  const fillPath = new Path()
  fillPath.move(new Point(points[0].x, height - padV))
  points.forEach((p) => fillPath.addLine(p))
  fillPath.addLine(new Point(points[points.length - 1].x, height - padV))
  fillPath.closeSubpath()

  const strokeColor = positive ? new Color(CFG.green) : new Color(CFG.red)
  const gradient = new LinearGradient()
  gradient.colors = [
    new Color(positive ? CFG.green : CFG.red, 0.25),
    new Color(positive ? CFG.green : CFG.red, 0.0),
  ]
  gradient.startPoint = new Point(0, 0)
  gradient.endPoint = new Point(0, height)

  ctx.addPath(fillPath)
  ctx.setFillColor(gradient)
  ctx.fillPath()

  ctx.addPath(linePath)
  ctx.setStrokeColor(strokeColor)
  ctx.setLineWidth(CFG.chartLineWidth)
  ctx.strokePath()

  return ctx.getImage()
}

// ═══════════ FORMATTERS ═══════════

function formatMoney(value, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatSignedMoney(value, currency) {
  const prefix = value >= 0 ? "+" : ""
  return prefix + formatMoney(value, currency)
}

function formatSignedPct(value) {
  const prefix = value >= 0 ? "+" : ""
  return `${prefix}${Number(value).toFixed(2)}%`
}

function shortDate(value) {
  if (!value) return "n/a"
  const d = new Date(value)
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}
