# SLA Countdown

[Docs home](../README.md) › [All plugins](README.md) › SLA Countdown

**Category:** Tickets · **Side panel tab:** ⏱ SLA · **Needs:** [the Freshservice API](freshservice.md#the-freshservice-api) (Freshservice plugin 0.8.5 or later)

A live countdown to each ticket's **first response** and **resolution** due times, so a breach doesn't creep up while you're in another tab.

## Using it

- **On the tab** – Every tab with a Freshservice ticket open shows the time left (or how long it's past due, like **−25m**) in front of its title. Hover it for both due times.
- **⏱ SLA tab** – Shows the ticket in the active tab, then **your open tickets** (assigned to the API key's agent), soonest deadline first. Click one to switch to its tab or open it.
- **Colours** – Grey while there's time, amber under an hour, red under 15 minutes, dark red once past due. Both thresholds are settings.
- **Alerts** – A notification under the bell when a ticket turns red or goes past due. At start-up, or when more than three go red at once, you get one summary instead.
- **On hold** – Tickets in Pending, or a custom status named On Hold, Awaiting… or Waiting…, show **Hold** instead of a countdown, because those normally stop the SLA clock. Resolved and closed tickets show nothing.

Due times are read again every 5 minutes (a setting) and when you switch to a ticket's tab. The countdown itself ticks every 30 seconds.

## Settings

**Settings → Plugins → SLA Countdown**

| Setting | What it does | Default |
|---|---|---|
| Show the countdown on ticket tabs | The badge in front of tab titles. | On |
| Notify me when a ticket turns red or goes past due | Alerts under the bell. | On |
| Turn amber when less than | Amber threshold. | 1 hour |
| Turn red when less than | Red threshold (never more than amber). | 15 minutes |
| Read the due times again every | How often to ask the API. | 5 minutes |

## Data

Settings only, in `settings.json`. Due times are kept in memory.

## Limits and known issues

- Freshservice only, and tickets only (not changes, problems or releases).
- "Your open tickets" shows up to 150 tickets (five pages from the API), and says so when you have more.
- **Hold** is a guess from the status name: if your SLA policy keeps counting in a status like Pending, the countdown won't show it.
- Due times come from Freshservice, so they follow your SLA policies and business hours there.

## See also

- [Quick Actions](quick-actions.md)
- [Ticket Notifications](ticket-notifications.md)
