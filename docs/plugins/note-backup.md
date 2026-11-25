# Note Backup

[Docs home](../README.md) › [All plugins](README.md) › Note Backup

**Stage:** [Beta](../plugin-release-stages.md) · **Category:** Notes & Replies · **Side panel tab:** 📋 Notes · **Needs:** a [site plugin](README.md#sites) for ticket detection and sync

A Notes tab for drafting ticket notes, so nothing is lost if the site logs you out or a page reloads. Every note is saved to disk as you type, with snapshots you can go back to, and can sync live with the site's own note editor.

## Using it

- **Ticket / Reference ID** – The box at the top shows the ticket the note belongs to. It follows the ticket in the active tab; you can type an ID by hand on pages the site plugin doesn't recognise.
- **Write** – A rich-text editor with bold, italic, underline, lists and clear formatting. `Ctrl+Shift+V` pastes as plain text. The HTML button swaps to a raw HTML view.
- **Autosave** – About 1.5 seconds after you stop typing. Typing that hasn't been saved yet is saved when the window closes.
- **Snapshots** – **💾 Save Snapshot** (`Ctrl+Shift+S`) saves a timestamped copy. One is also saved automatically on tab switch or sync pull when the note changed by more than the [snapshot threshold](#settings).
- **History** – Browse every snapshot for the ticket and click one to restore it.
- **Search** – Full-text search across all saved notes and drafts.
- **Copy** – Copies the note to the clipboard.
- **Templates and signature** – Insert a saved template from the toolbar, or your signature at the end of the note. Set them up in [Settings](#settings).
- **📁 Open Folder** – Opens the backup folder.

### Live sync

With **Live Sync** on, the Notes tab and the site's open note editor stay in step as you type, both ways:

- On [Freshservice](freshservice.md), the **Add note** / **Reply** editor or a note box such as the time-entry form.
- On [ConnectWise Manage](connectwise-manage.md), the time-entry notes editor or the stopwatch notes.

The pill at the bottom shows the state: `⇅ Synced`, `⇅ Pushing…` or `⇅ No notes field` (open the site's editor first). **Pull from FS / CW** and **Push to FS / CW** copy by hand when live sync is off.

### No silent loss

If a note can't be saved (over 10 MB, or the folder can't be written), you're told instead of it being treated as saved. Clearing, switching tickets, pulling from the site or applying an AI rewrite asks first rather than replacing a note whose backup failed.

Notes, templates and signatures are cleaned down to plain formatting before they're shown, so scripts, frames and similar content are dropped.

### Notes from ConnectWise Manage++

If the older ConnectWise Manage++ app was used on the same computer, its notes are copied in at start-up, filed as `CW-<number>`, and a notification says how many came across.

- The ConnectWise Manage++ folder is only read, never changed.
- Nothing in MSP++ is replaced. If a ticket already has a draft, the old one is added to its history as a snapshot.
- Notes you delete in MSP++ don't come back. Notes still being written in ConnectWise Manage++ are picked up at the next start.
- Imported notes count as new for **Backup Retention**, so they aren't cleaned up straight away.

## Settings

**Settings → Plugins → Note Backup**

| Setting | What it does | Default |
|---|---|---|
| Live Sync with Active Tab | Load the ticket's note when you switch tabs and keep it in sync with the site's note editor. | On |
| Backup Retention | Days to keep snapshots before automatic cleanup. `0` keeps them forever. | 7 days |
| Snapshot Threshold | Characters a note must change by before an automatic snapshot. | 5 |
| Storage Warning | Notify when the backup folder is bigger than this. `0` turns it off. | 100 MB |
| Ticket Sort Order | How saved tickets are listed: Last Updated or Ticket Number, ascending or descending. | Last Updated |
| Note Templates | Add, edit and delete templates. | none |
| Signature | HTML signature to insert at the end of a note. | empty |

## Data

In `note-backups\` in the [data folder](../data-files.md#the-data-folder):

- `autosave.json` – the latest draft for each ticket
- `<ticket>\<timestamp>.html` – snapshots, one folder per ticket (Freshservice by number, ConnectWise as `CW-<number>`)
- `editor-state.json`, `legacy-import.json` – housekeeping

Details in [Files and folders → Note Backup](../data-files.md#note-backup-datanote-backups). Turning the plugin off removes the Notes tab; your saved notes stay on disk.

## Limits and known issues

- Sync needs the site's editor to be open on the page.
- Notes are stored on this PC only. [Export Settings](../settings.md#move-settings-to-another-pc) doesn't include them; copy the `note-backups` folder to move them.

## See also

- [AI Features](ai-features.md) adds ✨ Suggest and 📋 Summarize to this tab
- [Canned Responses](canned-responses.md) for reusable replies
- [Troubleshooting → Notes and sync](../troubleshooting.md#notes-and-sync)
