# Ticket Search

[Docs home](../README.md) › [All plugins](README.md) › Ticket Search

**Category:** Tickets · **Side panel tab:** 🔎 Search · **Needs:** [the Freshservice API](freshservice.md#the-freshservice-api)

Find Freshservice tickets as you type, and open them in a tab.

## Using it

- **Type** a ticket number (`48211`, `#48211`, `INC-48211`), words from the subject (every word has to appear), or a requester's name or email.
- **Results** are tagged **number**, **subject** or **requester**, with the requester, status, priority and when the ticket was last updated.
- **Open** – Click a result (or press `Enter` for the highlighted one; arrow keys move) to open it in a new tab, or the current tab if you set that. `Ctrl`+click or middle-click opens it in a background tab.
- **Preview** – Rest the mouse on a result to see its status, requester, agent and latest reply.
- **Command palette** – Type in the `Ctrl+K` palette and matching tickets are listed under **Ticket Search** (`Enter` opens one, `Ctrl+Enter` in a new tab), with **Search tickets for "…"** to open this tab with the same search.

## Settings

**Settings → Plugins → Ticket Search**

| Setting | What it does | Default |
|---|---|---|
| Open a ticket I click in | A new tab or the current tab. | a new tab |
| Match subjects of tickets updated in the last | 7, 30, 90 or 180 days, or a year. | 30 days |
| Preview a ticket when I rest the mouse on a result | Hover card (two or three API calls per ticket, kept for a minute). | On |

## Data

Settings only, in `settings.json`. Results are kept in memory for two minutes.

## Limits and known issues

- Freshservice only. The key's agent needs permission to view tickets and requesters.
- **Subject search is limited.** Freshservice's API can't search subjects, so MSP++ fetches up to the 300 most recently updated tickets in the window above and matches subjects itself. An older ticket, or one outside the 300, won't be found by subject. Ticket numbers and requesters are looked up directly, however old the ticket.
- Custom statuses may show blank in results.

## See also

- [Recent Tickets](recent-tickets.md), for tickets you've already opened
- [Command palette](../browser.md#command-palette)
