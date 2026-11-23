# The side panel

[Docs home](README.md) › The side panel

The panel on the right holds a tab for each plugin that adds one. The app has no tabs of its own: install plugins to fill it.

| Tab | Plugin |
|---|---|
| 📋 Notes | [Note Backup](plugins/note-backup.md) |
| 🕘 Recent | [Recent Tickets](plugins/recent-tickets.md) |
| 🔎 Search | [Ticket Search](plugins/ticket-search.md) |
| ⚡ Actions | [Quick Actions](plugins/quick-actions.md) |
| ⏱ SLA | [SLA Countdown](plugins/sla-countdown.md) |
| ⏱ Time | [Time Tracker](plugins/time-tracker.md) |
| ⏰ Follow-ups | [Follow-up Reminders](plugins/follow-ups.md) |
| 💬 Replies | [Canned Responses](plugins/canned-responses.md) |
| 🤖 Assistant | [AI Assistant](plugins/ai-assistant.md) |
| 📚 Solutions | [Solutions Chat](plugins/solutions-chat.md) |
| 🌲 Tree | [Tree Style Tabs](plugins/tree-tabs.md) |

The last tab you used is reopened on launch. Your own plugins can add tabs too (see [`pluginAPI.ui.addSidePanelTab`](plugins.md#windowpluginapiuiaddsidepaneltabopts)).

## Show and hide

- Turn the panel on or off under **Settings → General → Side Panel**.
- Hide it with `Ctrl+Shift+B` or the ✕ button; a slim toggle button brings it back.
- Drag the divider to change its width.

## Split view

Right-click a side panel tab and choose **Move Tab to Bottom** to show it in a bottom half under the other tabs, for example Notes on top and Solutions below.

- Each half has its own tabs. Drag the bar between them to change how much room each gets; double-click it to even them out.
- **Move Tab to Top** puts a tab back. The split closes when the bottom half is empty.
- The layout and split position are kept between restarts.

## Lots of tabs

Tabs wrap onto more rows by default. Turn on **Settings → General → Scroll Side Panel Tabs** to keep them on one row and scroll with the ‹ › buttons or the mouse wheel.

## See also

- [All plugins](plugins/README.md)
- [Settings](settings.md)
