# MSP++ documentation

Welcome. MSP++ is a desktop browser for MSP and ticketing web apps (Freshservice and ConnectWise Manage today). The app itself is a tabbed browser with a side panel; almost every feature comes from a **plugin** you choose to install.

Start with the page that matches what you want to do.

## Using MSP++

| Page | What's in it |
|---|---|
| [Getting started](getting-started.md) | Installing on Windows, the first-start plugin picker, signing in |
| [The browser](browser.md) | Tabs, the address bar, the command palette, zoom, find, downloads, passkeys |
| [The side panel](side-panel.md) | The panel on the right, its tabs and split view |
| [Settings](settings.md) | Settings → General, themes, tab colours, moving settings to another PC |
| [Updates and notifications](updates-and-notifications.md) | The bell, automatic updates, alerts |
| [Keyboard shortcuts](keyboard-shortcuts.md) | Every shortcut in one table |
| [Troubleshooting](troubleshooting.md) | Common problems and fixes |

## Plugins

[**All plugins**](plugins/README.md) lists every plugin by category and explains how to install, update and remove them. Each plugin has its own page:

- **Sites:** [Freshservice](plugins/freshservice.md) · [ConnectWise Manage](plugins/connectwise-manage.md)
- **Tickets:** [Quick Actions](plugins/quick-actions.md) · [Recent Tickets](plugins/recent-tickets.md) · [SLA Countdown](plugins/sla-countdown.md) · [Ticket Notifications](plugins/ticket-notifications.md) · [Ticket Search](plugins/ticket-search.md)
- **Notes & Replies:** [Note Backup](plugins/note-backup.md) · [Canned Responses](plugins/canned-responses.md)
- **Time & Reminders:** [Time Tracker](plugins/time-tracker.md) · [Follow-up Reminders](plugins/follow-ups.md)
- **AI:** [AI Features](plugins/ai-features.md) · [Solutions Chat](plugins/solutions-chat.md)
- **Tabs & Toolbars:** [Bookmarks Bar](plugins/bookmarks-bar.md) · [Metrics Bar](plugins/metrics-bar.md) · [Tree Style Tabs](plugins/tree-tabs.md)
- **Security:** [Password Vault](plugins/password-vault.md)

## Reference

| Page | What's in it |
|---|---|
| [Files and folders](data-files.md) | Every file MSP++ and its plugins read or write: what to back up |
| [Building from source](building.md) | Running, testing and packaging the app; how releases are made |
| [Plugin development guide](plugins.md) | Writing your own plugin: the manifest and the full API |
| [Site plugins](sites.md) | Adding support for another ticketing site |
| [Example plugin](example-plugin/) | A small annotated plugin to copy |

## How these pages fit together

Each page covers one thing and links to the others where they meet. Plugin pages share the same layout: what the plugin does, how to use it, its settings, where it keeps its data, and what it can't do yet. Features that need the Freshservice API point to [Freshservice → API](plugins/freshservice.md#the-freshservice-api) for setup rather than repeating it.
