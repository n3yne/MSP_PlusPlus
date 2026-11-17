# Quick Actions

[Docs home](../README.md) › [All plugins](README.md) › Quick Actions

**Category:** Tickets · **Side panel tab:** ⚡ Actions · **Needs:** [the Freshservice API](freshservice.md#the-freshservice-api)

Change the open ticket's status, priority, group and agent without opening the ticket form.

## Using it

- **One click** – **👤 Assign to me**, **⏸ Pending** and **✔ Resolve** save straight away. Resolve asks first, since Freshservice may email the requester.
- **Status, priority, group, agent** – Pick new values and press **Save changes** (or **Undo**). Custom statuses from your Freshservice form are listed. Agents and groups come from the API and are kept for 10 minutes; **↻** reloads them.
- **The page catches up** – After a change the ticket's tab reloads so it shows the new values. If you've typed something on the page, you get a **Reload tab** button instead, so nothing is lost.
- **Command palette** – `Ctrl+K` has **Assign Ticket to Me**, **Resolve Ticket**, and **Set Ticket Status: …** / **Set Ticket Priority: …** for the open ticket.

## Settings

**Settings → Plugins → Quick Actions**

| Setting | What it does | Default |
|---|---|---|
| Reload the ticket's tab after a change | Reload so the page shows the new values. | On |
| Ask before resolving a ticket | Confirm before **Resolve**. | On |

## Data

Settings only, in `settings.json`. Agent and group lists are kept in memory.

## Limits and known issues

- Freshservice only, and tickets only (not changes, problems or releases).
- The API key's agent needs permission to edit tickets and list agents and groups.
- If you turn reloading off, saving the ticket form on a page that still shows the old values can put them back.

## See also

- [SLA Countdown](sla-countdown.md)
- [Ticket Search](ticket-search.md)
