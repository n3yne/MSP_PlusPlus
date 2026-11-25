# ConnectWise Manage

[Docs home](../README.md) › [All plugins](README.md) › ConnectWise Manage

**Stage:** [Beta](../plugin-release-stages.md) · **Category:** Sites · **Needs:** nothing

The ConnectWise Manage site plugin makes MSP++ understand ConnectWise Manage pages. It works alongside [Freshservice](freshservice.md): each tab uses the right site automatically.

## What it does

- **Ticket detection** – Reads the ticket number from the address or the page and saves it as `CW-123456`, so it never collides with Freshservice numbers.
- **Note sync** – Lets [Note Backup](note-backup.md#live-sync) sync the Notes tab with the time-entry notes editor and the stopwatch notes. Stopwatch notes are reached by opening the stopwatch popup out of sight, saving it as a draft and closing it again. **Pull from CW** / **Push to CW** copy by hand.
- **Reply box** – Lets [Canned Responses](canned-responses.md) insert replies into the notes editor.
- **Ticket notes for AI** – Gives [AI Features](ai-features.md) Summarize the ticket's notes (author, date and text), read from the page.
- **Time entries** – Lets [Time Tracker](time-tracker.md) fill in the hours of the time entry open on the page.
- **Address bar** – Type `CW-12345` in the address bar or `Ctrl+K` palette to open a ticket (needs a ConnectWise tab open, to know your instance).

## Using it

Open ConnectWise Manage (`*.myconnectwise.net`, or your own server) in any tab and sign in. Nothing else to set up unless you use your own server.

## Settings

| Setting | What it does | Default |
|---|---|---|
| Custom URL | If ConnectWise Manage runs on your own server or domain instead of `myconnectwise.net`, enter its address (such as `https://connectwise.yourcompany.com`). Pages on that host are treated as ConnectWise Manage and get the Chrome user agent and sign-in popups. Only the host name is kept. Reload any ConnectWise tabs that are already open. | empty |

## Data

The Custom URL is kept in `settings.json`. Notes are saved by [Note Backup](note-backup.md#data) under `CW-<number>`.

Notes from the older ConnectWise Manage++ app are copied in automatically at start-up; see [Note Backup → Notes from ConnectWise Manage++](note-backup.md#notes-from-connectwise-manage).

## Limits and known issues

- No API features yet: [Ticket Search](ticket-search.md), [Quick Actions](quick-actions.md), [SLA Countdown](sla-countdown.md), [Ticket Notifications](ticket-notifications.md) and hover previews are Freshservice only.
- [Time Tracker](time-tracker.md) fills in an open time entry but doesn't save it: press Save in ConnectWise.
- Everything is read from the page, so a ConnectWise Manage layout change can break detection or sync until the plugin is updated.

## See also

- [Freshservice](freshservice.md)
- [Site plugins](../sites.md), for developers
- [Troubleshooting → Sites and sign-in](../troubleshooting.md#sites-and-sign-in)
