<p align="center"><img src="icon.svg" alt="MSP++ icon" width="128"></p>

# MSP++

A desktop browser for MSP and ticketing web apps (Freshservice and ConnectWise Manage today). It wraps the sites you already use in tabs and adds a side panel, a note editor that never loses your work, live note sync, AI help, ticket tools and quality-of-life browser features on top.

**Current version:** 0.8.4

> MSP++ was called **Freshservice++** before 0.6.0. Your settings, notes and sign-ins carry over: the app keeps using the existing Freshservice++ data folder.

**📖 [Read the documentation](docs/README.md)**

---

## Highlights

- **A browser built for tickets** – Tabs that come back after a restart, an address bar that opens `12345` or `CW-12345` as a ticket, a `Ctrl+K` command palette, per-site zoom and tab colours, passkey sign-in. [More](docs/browser.md)
- **Notes that never get lost** – A Notes tab that saves as you type, keeps snapshots, and syncs live with the site's note editor. [Note Backup](docs/plugins/note-backup.md)
- **Ticket tools** – Search tickets, change status and assignee in one click, count down to SLA deadlines, and get a desktop alert when a ticket gets a reply. [Ticket plugins](docs/plugins/README.md#tickets)
- **Time and reminders** – A timer per ticket that logs time entries, and follow-up reminders. [Time Tracker](docs/plugins/time-tracker.md) · [Follow-up Reminders](docs/plugins/follow-ups.md)
- **AI** – Rewrite notes, summarise tickets, and ask questions answered from your knowledge base. [AI Features](docs/plugins/ai-features.md) · [Solutions Chat](docs/plugins/solutions-chat.md)
- **Your numbers in view** – A metrics bar with live dashboard figures or Freshservice ticket counts, and weekly targets. [Metrics Bar](docs/plugins/metrics-bar.md)
- **Only what you need** – Every feature is a plugin you install from the built-in plugin directory. [All plugins](docs/plugins/README.md)

## Get started

1. Download the latest Windows installer (`MSP-PlusPlus-Setup-<version>.exe`) or portable `.exe` from [Releases](https://github.com/n3yne/MSP_PlusPlus/releases).
2. On first start, choose your site (Freshservice and/or ConnectWise Manage) and any plugins.
3. Set your **Home URL** in Settings (`Ctrl+,`) and sign in.

Full steps: [Getting started](docs/getting-started.md).

## Documentation

| | |
|---|---|
| **Using MSP++** | [Getting started](docs/getting-started.md) · [The browser](docs/browser.md) · [The side panel](docs/side-panel.md) · [Settings](docs/settings.md) · [Updates and notifications](docs/updates-and-notifications.md) · [Keyboard shortcuts](docs/keyboard-shortcuts.md) · [Troubleshooting](docs/troubleshooting.md) |
| **Plugins** | [All plugins](docs/plugins/README.md), with a page for each |
| **Reference** | [Files and folders](docs/data-files.md) · [Building from source](docs/building.md) |
| **Developers** | [Plugin development guide](docs/plugins.md) · [Site plugins](docs/sites.md) · [Example plugin](docs/example-plugin/) |

## Build from source

```bash
npm install
npm start      # run
npm test       # lint with npm run lint
npm run build  # Windows installer and portable .exe in dist/
```

Details, the macOS build and how releases are made: [Building from source](docs/building.md).
