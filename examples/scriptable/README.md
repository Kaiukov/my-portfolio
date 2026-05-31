# Scriptable Portfolio Widget

A [Scriptable](https://scriptable.app/) medium widget for iPhone Home Screen that displays your portfolio value from a `widget.json` endpoint. Visual style matches the Yahoo Finance "My holdings" light-theme card (white card, bold portfolio value, green/red Today and Total metrics, filled-area sparkline).

## Prerequisites

- **iPhone** running iOS 14 or later
- **Scriptable** app (free, by Simon Stovring) — [App Store link](https://apps.apple.com/app/scriptable/id1405459188)
- A **publicly accessible `widget.json` endpoint** that serves the portfolio data. See [Widget Contract](../../docs/widget-contract.md) for the exact JSON shape the widget expects. You typically get this URL from your portfolio hosting server after deployment.

---

## Step-by-step installation

### Step 1: Install Scriptable

1. Open the **App Store** on your iPhone.
2. Search for **"Scriptable"** (by Simon Stovring). It is **free** — no in-app purchases or subscriptions required.
3. Tap **Get** to download and install.

### Step 2: Create a new script

1. Open the **Scriptable** app on your iPhone.
2. Tap the **+** (plus) icon in the top-right corner of the screen. A blank script editor opens.
3. Tap the **script name** field at the very top (it defaults to "Untitled Script") and rename it to `Portfolio`. (You can use any name — this is what you will select later when configuring the widget.)

### Step 3: Paste the widget code

1. From a computer or your iPhone browser, open the file [`portfolio-widget.js`](portfolio-widget.js) from this repository.
2. **Select all** of its contents (Command+A on Mac, or long-press + Select All on iPhone).
3. **Copy** the selection.
4. In Scriptable, **long-press** the empty script editor area and tap **Paste** to replace the blank template with the widget code.
5. Tap **Done** in the top-right corner to save.

### Step 4: Configure the widget URL

This is the most important step. The widget fetches your portfolio data by making an HTTPS request to your `widget.json` endpoint.

1. Open the `Portfolio` script again (tap it in the Scriptable script list).
2. Find **line 10** near the top of the file — it looks like this:

```js
const URL = "https://example.com/widget.json?token=CHANGE_ME"
```

3. **Replace the entire URL** (keeping the quotes) with your real endpoint URL. For example:

```js
const URL = "https://your-server.com/api/v1/widget.json?token=abc123xyz"
```

4. Tap **Done** to save.

#### ⚠️ Security warning — read carefully

- The URL in the script will be **stored in plain text** on your iPhone. Anyone with physical access to your unlocked phone can open the script and read it.
- **Never** put database credentials, connection strings, PostgreSQL/Supabase URLs, API admin keys, or any permanent secrets in this URL.
- The `widget.json` endpoint should use a **read-only**, **scoped** token that can **only** fetch this specific data — nothing else.
- If you suspect the token was compromised, revoke it and generate a new one from your server.
- The Scriptable widget **never** connects to your database directly — it only reads JSON over HTTPS.

### Step 5: Test the script

Before placing the widget on your Home Screen, test that it works:

1. In Scriptable, tap the **play (▶️)** button in the bottom toolbar. The script runs and briefly shows a preview of the widget.
2. **If the URL is correct and reachable:** You will see a white card with your portfolio title, the last-refresh timestamp, your portfolio value (e.g. `$19,257.13`), and the Today/Total metrics with a sparkline chart.
3. **If the URL is wrong, the token is invalid, or there is no internet:** A red error message appears that says something like "Could not load widget data" followed by a hint to check the URL. This is the script's built-in error fallback — it means the widget could not fetch the JSON.
4. **If the JSON is returned but the shape is wrong:** You will see a red error like "widget.json missing field: value" — this means your endpoint is responding but not with the expected contract. Check the [Widget Contract](../../docs/widget-contract.md) to verify your server output.

If you see an error, go back to Step 4, double-check the URL and token, and ensure your iPhone has an active internet connection.

### Step 6: Add the widget to your Home Screen

1. **Exit Scriptable** and go to your iPhone's **Home Screen**.
2. **Long-press** an empty area of the Home Screen until the icons start jiggling and the **+** (plus) button appears in the top-left corner.
3. Tap the **+** button.
4. In the search bar at the top, type **"Scriptable"** and tap the Scriptable icon when it appears.
5. **Swipe left/right** through the available widget sizes until you find **Medium** — the medium widget is required for this script because the layout is designed for that size.
6. Tap **"Add Widget"** (the blue button at the bottom).
7. The widget appears on your Home Screen. Tap **Done** (top-right) to stop jiggling.
8. **Long-press** the new Scriptable widget on your Home Screen and select **"Edit Widget"** from the pop-up menu.
9. In the configuration panel:
   - Tap **"Script"** and select **"Portfolio"** (or whatever you named it in Step 2).
   - Tap **"When Interacting"** and select **"Run Script"** (this makes the widget briefly open Scriptable and re-run when you tap it — useful for manual refresh).
10. Tap anywhere outside the config panel to close it.

The widget should now display your portfolio data on your Home Screen.

### Step 7: Understanding refresh behavior

- **iOS controls refresh timing.** Widgets on iOS do not refresh on a fixed schedule — the system decides when to update them based on usage patterns, battery state, and time since last refresh. Refreshes typically happen every few minutes to several hours.
- **The "Last refresh" line** in the widget shows when the data was generated on your server (not when the widget last ran on your phone). It displays a relative time like *"Last refresh: 3 hr ago"*. If your server hasn't recalculated recently, this time will lag no matter how often the widget runs.
- **To force a refresh:** Tap the widget on your Home Screen (if "When Interacting" is set to "Run Script" in Step 6). This opens Scriptable and re-runs the script, after which the widget displays fresh data. You can also re-run it from within Scriptable by tapping the **▶️** button.
- **If "Last refresh" shows "n/a":** Your server endpoint is not including the `last_refresh` field in the JSON response. Check your server output.

### Step 8: Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Widget shows **red error text**: "Could not load widget data" | Network error, wrong URL, or invalid token | Open the script in Scriptable, double-check line 10 — the entire URL including the token must be correct. Ensure your iPhone has an internet connection (try loading the URL in Safari). |
| Widget shows **red error text**: "widget.json missing field: ..." | Server responds but JSON shape is wrong | Your endpoint returns JSON but it is missing required fields. Verify the output matches the [Widget Contract](../../docs/widget-contract.md). |
| Widget shows **only the title** (no value, no chart) | Partial JSON or HTTP error | Check the endpoint URL. Look for network errors in your server logs. |
| **Blank white widget** (no text at all) | Script not selected in widget config | Long-press the widget → Edit Widget → make sure "Script" is set to "Portfolio" (or your script name). |
| **Stale data** — numbers have not changed for hours | iOS has not refreshed the widget, or your server has not recalculated | Tap the widget to force a manual refresh. Check the "Last refresh" timestamp to see if the server data is stale. |
| **Sparkline is missing** | No `series` data in JSON response | Ensure your endpoint includes the `series` array with at least 2 data points. |
| The widget displays **yesterday's numbers** | Your server generates `widget.json` once per day | This is expected — the widget can only show what the server provides. Check your server's recalculation schedule. |
| **"Scriptable" does not appear** when adding a widget | Widget already added, or iOS version too old | Make sure you are on iOS 14+. Try restarting your iPhone. |

#### How to edit the script after installation

1. Open **Scriptable**.
2. Tap the **"Portfolio"** script in the list.
3. Make your changes (e.g. fix the URL).
4. Tap **Done** to save. The widget will pick up changes on its next refresh.

---

## Visual design reference

The widget layout matches the Yahoo Finance "My holdings" light-theme card:

| Element | Description |
|---|---|
| Background | White (`#FFFFFF`); iOS draws rounded corners automatically |
| Title | Bold near-black (`#1A1A1A`), ~22pt, top-left |
| Subtitle | `"Last refresh: 3 hr ago"` in gray (`#8E8E93`), ~13pt |
| Portfolio value | Bold near-black (`#1A1A1A`), ~40pt, currency-formatted with grouped thousands |
| Bottom row | Left: Today/Total metrics — Right: filled-area sparkline |
| Today line | `Today  +$125.50 (0.65%)` — label in gray, number in green or red |
| Total line | `Total  +$4,257.13 (28.30%)` — same style as Today |
| Sparkline | Filled area chart; green if today's change ≥ 0, red if negative |

Color key: positive values `#16A34A` (green), negative values `#DC2626` (red).

---

## Adding the widget to a second phone (e.g. spouse, family)

You can share the same portfolio widget across multiple iPhones:

1. **On the second phone**, repeat Steps 1–6 with the **same widget URL** from your server.
2. The easiest way to transfer the script is:
   - **AirDrop:** Open the `Portfolio` script in Scriptable on the first phone, tap the share icon (box with arrow), tap **AirDrop**, and select the second phone.
   - **Manual copy:** Send yourself the URL and paste it into a fresh script on the second phone.
   - **iCloud:** If both phones use the same Apple ID, Scriptable scripts may sync via iCloud automatically.
3. Both phones will display the same portfolio data because they fetch from the same URL.

---

## JSON contract

The widget consumes a JSON object with the following shape. All field names (`today.amount`, `today.pct`, `total.amount`, `total.pct`, `series[].date`, `series[].value`) must match exactly.

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

See the full [Widget Contract](../../docs/widget-contract.md) for field descriptions and invariants.

---

## Security notes

- The `URL` in the script is a publicly routable endpoint — keep the token secret but treat it as **not a permanent credential**.
- Never embed database connection strings, PostgreSQL/Supabase URLs, or admin API keys in the script.
- Use a **read-only**, **scoped** token that can only fetch this widget endpoint.
- The widget **never** connects to your database — it only reads JSON over HTTPS.
