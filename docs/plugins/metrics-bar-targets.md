# Metrics Bar: weekly targets

[Docs home](../README.md) › [All plugins](README.md) › [Metrics Bar](metrics-bar.md) › Weekly targets

Give a [Metrics Bar](metrics-bar.md) field a **Weekly target** and its card is coloured by how you're doing against it for this point in the week.

## Colours

| Colour | Meaning |
|---|---|
| Green | Target reached |
| Yellow | Slightly behind pace (less than expected, but within 10%) |
| Red | More than 10% behind pace |

"Expected" is the target times how much of your work week has passed. Hover a card to see it, for example **On track: 18.5 of 40**.

## Progress tracking settings

Under **Settings → Plugins → Metrics Bar → Progress Tracking**:

| Setting | What it does | Default |
|---|---|---|
| Work days | Which days count. | Monday–Friday |
| Week ends on | The last day of your work week. | Friday |
| Work hours | Start and end of your day. | 8:00–17:00 |
| Lunch break | Minutes a day that don't count. | 0 |
| Time Off | Days or hours off (**+ Add PTO**). The target is scaled down for that week. | none |
| Weekly Blocks | Time reserved every week, such as meetings. It reduces the on-track hours without changing the target. | none |
| Adjusted target rounding | How a target scaled for time off is rounded: none (22.5), down (22) or up (23). | none |

## Resets every week

Each field has a **Resets every week** box, ticked by default.

- **Ticked** – The value counts from the start of the work week (tickets closed this week, say). At the start of a new week the bar shows 0 until the first refresh, and ignores a refreshed value that still matches last week's for an hour, in case the dashboard hasn't rolled over yet. This also happens when MSP++ is left open over the weekend.
- **Unticked** – The value doesn't reset, such as open tickets or a running total. The bar keeps showing it at the start of the week, and the weekly target and colours aren't used.

## See also

- [Metrics Bar](metrics-bar.md)
- [Freshservice API queries](metrics-bar-api-queries.md)
