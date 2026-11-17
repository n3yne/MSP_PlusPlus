# Time Tracker

[Docs home](../README.md) › [All plugins](README.md) › Time Tracker

**Category:** Time & Reminders · **Side panel tab:** ⏱ Time · **Needs:** [the Freshservice API](freshservice.md#the-freshservice-api) or [ConnectWise Manage](connectwise-manage.md) to log time (Copy works anywhere)

A timer per ticket. When you're done, it logs the time as a time entry on the ticket, or copies it for anywhere else.

## Using it

- **Start** – Open a ticket and press **Start** in the ⏱ Time tab, or right-click its tab and choose **⏱ Start Timer for This Ticket**. Each ticket has its own timer; starting one pauses the others unless you turn that off. **Start a timer when I open a ticket** does it for you.
- **Adjust** – **−5** and **+5** fix a timer you forgot to start or stop. The list shows every timer, and the header shows the total not yet logged.
- **Log time** – Enter a note and:
  - **Freshservice:** press **Log in Freshservice** to add a time entry through the API, as the agent the API key belongs to. Works on tickets, changes, problems and releases. Tick or untick **Billable** for this entry.
  - **ConnectWise Manage:** open a new time entry on the ticket, press **Fill CW time entry** to put the hours in, then save it in ConnectWise. The note comes from the [Notes tab's live sync](note-backup.md#live-sync).
  - **Anywhere else, or if logging fails:** **Copy** puts the time (h:mm and decimal hours), ticket and note on the clipboard, and **Mark logged** resets the timer.
- **Logged today** – A summary of the time you logged today, per ticket, with the day's total. Expand a ticket to see each entry. **‹** and **›** go back through earlier days (90 days are kept). **📋 Copy** puts the summary on the clipboard for a timesheet or stand-up. Both **Log** and **Mark logged** count; removing an entry from the summary (✕) doesn't change the time entry on the site.
- **Safe on close** – Running timers are paused when MSP++ closes, and saved every minute, so a crash loses at most a minute.

## Settings

**Settings → Plugins → Time Tracker**

| Setting | What it does | Default |
|---|---|---|
| Round logged time up to | The next 1, 5, 6 (0.1 h), 10, 15 or 30 minutes. The timer itself keeps the exact time. | the next minute |
| Run one timer at a time | Starting a timer pauses the others. | On |
| Start a timer when I open a ticket | Starts a timer automatically. | Off |
| Mark time entries billable by default | The starting value of **Billable** when logging to Freshservice. | On |

## Data

`plugins\time-tracker\timers.json` in the [data folder](../data-files.md#plugin-data-datapluginsplugin-id): timers and the last 90 days of logged time. If it can't be read, it's kept as `timers.json.corrupt-<time>` and a new list is started.

## Limits and known issues

- Freshservice logging needs the key's agent to have permission to add time entries, and entries are always added for that agent.
- On ConnectWise Manage the plugin fills in the hours but doesn't save the time entry.
- Timers and the daily summary are on this PC only.

## See also

- [Follow-up Reminders](follow-ups.md)
- [Freshservice → The Freshservice API](freshservice.md#the-freshservice-api)
