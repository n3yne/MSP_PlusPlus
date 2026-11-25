# Recent Tickets

[Docs home](../README.md) › [All plugins](README.md) › Recent Tickets

**Stage:** [Beta](../plugin-release-stages.md) · **Category:** Tickets · **Side panel tab:** 🕘 Recent · **Needs:** a [site plugin](README.md#sites)

A list of the tickets you've viewed lately, on any site, newest first. Click one to go back to it.

## Using it

- **Every site** – A ticket is added when it shows in the active tab: [Freshservice](freshservice.md) tickets, changes, problems and releases, [ConnectWise Manage](connectwise-manage.md) tickets, or any site plugin that knows its tickets. Each entry shows the site, number, subject and when you last looked, grouped into Today, Yesterday, Earlier this week and Older.
- **Reopen** – Click an entry to switch to the tab already showing that ticket, or open it in a new tab if none is. `Ctrl`+click or middle-click always opens a new tab.
- **Filter** by number, subject or site, then press `Enter` to open the first match.
- **Pin** (☆) keeps a ticket at the top. Each row also has **Copy link** and **✕**. **Clear** empties the list but keeps pinned tickets.
- **Preview** – Rest the mouse on a Freshservice ticket to see its status, requester, agent and latest reply.
- **Command palette** – `Ctrl+K` lists your pinned and latest few tickets straight away, and every remembered ticket once you type part of its number, subject or site.

## Settings

**Settings → Plugins → Recent Tickets**

| Setting | What it does | Default |
|---|---|---|
| Remember up to | 10, 25, 50, 100 or 200 tickets. Pinned tickets don't count. | 50 |
| Switch to the ticket's tab when it's already open | Off: always open another tab. | On |
| Preview a ticket when I rest the mouse on it | Hover card with status, requester, agent and latest reply. | On |

## Data

`plugins\recent-tickets\recent.json` in the [data folder](../data-files.md#plugin-data-datapluginsplugin-id). If it can't be read, it's kept as `recent.json.corrupt-<time>` and a new list is started.

## Limits and known issues

- Hover previews need the site's API ([Freshservice API](freshservice.md#the-freshservice-api)); ConnectWise Manage tickets have no preview yet.
- Only tickets shown in the active tab are added.

## See also

- [Ticket Search](ticket-search.md), for tickets you haven't opened
- [Command palette](../browser.md#command-palette)
