# Metrics Bar: Freshservice API queries

[Docs home](../README.md) › [All plugins](README.md) › [Metrics Bar](metrics-bar.md) › API queries

A [Metrics Bar](metrics-bar.md) field can carry a Freshservice ticket filter query. The bar then shows how many tickets match it, straight from the Freshservice API, and reads the dashboard for that field only if the API call fails.

## Setting one up

1. Set up [the Freshservice API](freshservice.md#the-freshservice-api).
2. In **Settings → Plugins → Metrics Bar**, fill in a field's **API query**, such as `agent_id:123 AND status:2`.
3. Click **Test** to see the count.

Freshservice has no API for dashboard widgets, so the query has to describe the same tickets as the widget.

## Writing a query

| | |
|---|---|
| **Fields** | `agent_id`, `group_id`, `requester_id`, `status`, `priority`, `impact`, `urgency`, `tag`, `due_by`, `fr_due_by`, `created_at`, `updated_at` and custom fields |
| **Statuses** | 2 Open, 3 Pending, 4 Resolved, 5 Closed. Custom statuses have higher numbers. |
| **Operators** | `AND`, `OR`, brackets, and `:<` / `:>` for less / greater than |
| **Quotes** | Text and dates go in single quotes: `tag:'vip'`, `updated_at:>'2026-11-01'` |
| **Dates** | `{today}`, `{weekStart}` and `{monthStart}` are filled in for you |

Examples:

| Count | Query |
|---|---|
| My open tickets | `agent_id:123 AND status:2` |
| My tickets resolved this week (approximate) | `agent_id:123 AND status:4 AND updated_at:>'{weekStart}'` |
| Not resolved or closed | `agent_id:123 AND (status:<4 OR status:>5)` |

## Limits

- There is no NOT. Use ranges instead, as in the last example.
- There is no "resolved on" date, so "resolved this week" can only be approximated with `updated_at`.
- Freshservice reads a date as a whole day in UTC, so tickets from the first or last few hours of a day can count on the neighbouring day.
- Some widget filters, such as "tickets I'm watching", can't be expressed as a query. Keep reading those from the dashboard.
- A query can be at most 512 characters.

## See also

- [Metrics Bar](metrics-bar.md)
- [Weekly targets](metrics-bar-targets.md)
