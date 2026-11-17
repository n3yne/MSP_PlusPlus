# Follow-up Reminders

[Docs home](../README.md) › [All plugins](README.md) › Follow-up Reminders

**Category:** Time & Reminders · **Side panel tab:** ⏰ Follow-ups · **Needs:** nothing

Set a reminder on a ticket and get a desktop alert when it's time to come back to it.

## Using it

- **Set one** – On any ticket ([Freshservice](freshservice.md), [ConnectWise Manage](connectwise-manage.md), or any web page) open the ⏰ Follow-ups tab and pick **In 1 hour**, **In 3 hours**, **5 PM today**, **Tomorrow 9:00 AM**, **Monday 9:00 AM** or a date and time of your own, with an optional note.
- **Other ways** – Right-click a tab and choose **Remind Me to Follow Up…**, or type "Follow up" in the `Ctrl+K` [command palette](../browser.md#command-palette).
- **When it's due** – MSP++ shows a Windows notification and one under the bell; click either to open the ticket. Reminders that came due while MSP++ was closed go off when it next starts.
- **Due list** – Reminders that have gone off stay at the top under **Due** until you **💤 snooze** them (15 minutes, 1 hour, 3 hours, tomorrow or a time you pick) or mark them **✓ done** (with Undo).
- One reminder per ticket: setting a new time replaces the old one.

## Settings

**Settings → Plugins → Follow-up Reminders**

| Setting | What it does | Default |
|---|---|---|
| Show a desktop alert when a reminder is due | Windows notification as well as the bell. | On |
| Play the notification sound | Sound with the desktop alert. | On |
| "Tomorrow" and "Monday" mean | The time used by those choices, 6 to 11 AM. | 9:00 AM |
| Send a test alert | Checks that Windows shows MSP++ notifications. | – |

## Data

`plugins\follow-ups\reminders.json` in the [data folder](../data-files.md#plugin-data-datapluginsplugin-id): site, ticket, subject, link, note, due time and whether it has gone off. If it can't be read, it's kept as `reminders.json.corrupt-<time>` and a new list is started.

## Limits and known issues

- Reminders only go off while MSP++ is running (missed ones go off at the next start).
- If no desktop alert appears, check that notifications are on for MSP++ in Windows Settings → System → Notifications. The bell shows them either way.

## See also

- [Time Tracker](time-tracker.md)
- [Updates and notifications](../updates-and-notifications.md)
