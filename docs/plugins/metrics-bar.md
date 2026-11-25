# Metrics Bar

[Docs home](../README.md) › [All plugins](README.md) › Metrics Bar

**Stage:** [Stable](../plugin-release-stages.md) · **Category:** Tabs & Toolbars · **Needs:** a dashboard (such as BrightGauge), or [the Freshservice API](freshservice.md#the-freshservice-api) for ticket counts

A bar above the tab strip showing live numbers, such as tickets closed this week, read from one or more dashboards or counted through the Freshservice API.

This page covers the basics. Two pages go deeper:

- [Freshservice API queries](metrics-bar-api-queries.md): count tickets straight from Freshservice instead of reading a dashboard.
- [Weekly targets](metrics-bar-targets.md): goals, on-track colours, work hours, time off and the weekly reset.

## Setting it up

1. Open **Settings → Plugins → Metrics Bar**, turn on **Show Metrics Bar** and choose a **Refresh interval**.
2. Click **+ Add Dashboard** and paste the address of a dashboard, such as a BrightGauge public dashboard.
3. Click **+ Add Field**. The dashboard opens in a picker.
4. Wait for it to load, then click the number you want to track.
5. Give the field a label and click **Add Metric**.
6. Repeat for each number. Add more dashboards the same way; all their fields show together in the bar.

**Tip:** for a leaderboard, click the value in the row with your name. The picker ties the field to your name, so it stays right when your rank changes.

## Using it

- Each card shows a value with its label underneath. Hover for details, such as how far along you should be this week and whether the value came from the dashboard or the API.
- **Click a card** to open its dashboard in a new tab.
- The **refresh** button reads everything again now.
- If a refresh fails, the card keeps its last value with a `⚠`. Hover it to see when it was last updated.

## Settings

| Setting | What it does | Default |
|---|---|---|
| Show Metrics Bar | Show the bar. | Off |
| Refresh interval | Every 5, 15, 30 or 60 minutes. | 15 minutes |
| Dashboards | Each dashboard's address and its tracked fields. **Test selectors** reloads it and shows what each field finds. | none |
| Field: label | Text under the value. | – |
| Field: CSS selector | Where the value is on the page. Captured by the picker; edit by hand if needed, or **Re-pick**. | – |
| Field: API query | Optional Freshservice filter. See [API queries](metrics-bar-api-queries.md). | empty |
| Field: Weekly target, Resets every week | See [Weekly targets](metrics-bar-targets.md). | – |
| Progress Tracking | Work days, hours, lunch, time off and weekly blocks. See [Weekly targets](metrics-bar-targets.md#progress-tracking-settings). | Mon–Fri, 8:00–17:00 |

## Data

Settings are in `settings.json`. The last value of each field is cached in the browser profile's Local Storage, so the bar has numbers straight away at start-up. See [Files and folders](../data-files.md#browser-profile-data).

## Limits and known issues

- Reading a dashboard depends on its layout. If it changes, a field can show `(not found — check selector)`: click **Test selectors**, then **Re-pick** the field.
- Dashboards are read in a hidden page, so they must open without a sign-in (public dashboards), unless you're already signed in to them in MSP++.
- Freshservice's own dashboard widgets are drawn after the page loads, so the bar waits up to 30 seconds for the numbers to settle. An [API query](metrics-bar-api-queries.md) is faster and more reliable.

## See also

- [Freshservice API queries](metrics-bar-api-queries.md)
- [Weekly targets](metrics-bar-targets.md)
- [Troubleshooting → Metrics Bar](../troubleshooting.md#metrics-bar)
