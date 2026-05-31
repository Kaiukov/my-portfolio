# Scriptable Portfolio Widget

A Scriptable medium widget for iPhone Home Screen that displays your portfolio value from a `widget.json` endpoint.

## Prerequisites

- iPhone with iOS 14+
- [Scriptable](https://scriptable.app/) installed from the App Store
- A publicly-accessible `widget.json` endpoint (see [Widget Contract](../../docs/widget-contract.md))

## Setup

### 1. Install Scriptable

Download [Scriptable](https://scriptable.app/) from the iOS App Store. No Apple Developer Program required.

### 2. Create the script

1. Open Scriptable, tap the **+** icon in the top-right corner.
2. Paste the full contents of `portfolio-widget.js`.
3. Edit the `URL` at the top of the script to point to your widget.json endpoint:

```js
const URL = "https://your-domain.com/widget.json?token=YOUR_TOKEN"
```

4. Tap **Done** to save. Name it `Portfolio Widget`.

### 3. Add widget to Home Screen

1. Long-press the Home Screen, tap the **+** button (top-left).
2. Search for **Scriptable**, select it.
3. Choose the **medium** widget size.
4. Tap **Add Widget**, then tap the widget to configure it.
5. Set **Script** to `Portfolio Widget` and **When Interacting** to `Run Script`.
6. Tap outside to finish.

### 4. Add to another phone

Repeat steps 1-3 on the other device with the same script URL. Scriptable scripts can be shared via iCloud or AirDrop, or pasted manually.

## Security

- The `URL` at the top of the script points to a public or token-protected endpoint.
- Do **not** embed database credentials, connection strings, or API keys other than the widget token in the script.
- Use a short-lived or read-only token scoped to the widget endpoint only.
- The widget does **not** connect to PostgreSQL/Supabase — it only reads JSON over HTTPS.

## Widget layout

| Element | Description |
|---|---|
| Dark background | `#111111` |
| Title | `"Portfolio"` |
| Large value | Current portfolio value with currency |
| Today line | Daily change (green/red) |
| Total line | Total gain/loss (green/red) |
| Sparkline | 30-day value trend with gradient fill |
| Footer | Last refresh timestamp |

## JSON contract

The widget consumes the stable contract defined in [`docs/widget-contract.md`](../../docs/widget-contract.md):

```json
{
  "title": "Portfolio",
  "currency": "USD",
  "as_of_date": "2026-05-30",
  "last_refresh": "2026-05-30",
  "value": 19257.13,
  "today": { "amount": 125.50, "pct": 0.65 },
  "total": { "amount": 4257.13, "pct": 28.3 },
  "series": [
    { "date": "2026-05-01", "value": 19000.00 },
    { "date": "2026-05-02", "value": 19050.00 }
  ]
}
```

All field names in the widget script match this contract exactly: `today.amount`, `today.pct`, `total.amount`, `total.pct`, `series[].date`, `series[].value`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Red error text "Could not load widget data" | Network error or bad URL | Check the URL in the script. Ensure the endpoint is reachable from the iPhone on the same network. |
| Red error text "widget.json missing field" | Invalid JSON response | Verify the endpoint returns the exact contract shape. |
| Widget shows only title and error | HTTP timeout | Check the URL token. Increase `req.timeoutInterval` in the script. |
| Widget shows "n/a" for last refresh | `last_refresh` is missing or null | Ensure the endpoint includes the `last_refresh` field. |
