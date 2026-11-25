# All plugins

[Docs home](../README.md) › All plugins

MSP++ comes with no plugins built in. Every feature below installs from the **plugin directory** under **Settings → Plugins → Browse**. Install only what you use.

## By category

### Sites

A site plugin teaches MSP++ about a ticketing site: how to find the ticket number, where the note editor is, and how to use the site's API. Install at least one.

| Plugin | What it does | Needs |
|---|---|---|
| [Freshservice](freshservice.md) | Ticket detection, note sync and the Freshservice API that many plugins use | – |
| [ConnectWise Manage](connectwise-manage.md) | Ticket detection and note sync for ConnectWise Manage, including your own server | – |

### Tickets

| Plugin | What it does | Needs |
|---|---|---|
| [Quick Actions](quick-actions.md) | ⚡ Actions tab: change status, priority, group and agent without the ticket form | Freshservice API |
| [Recent Tickets](recent-tickets.md) | 🕘 Recent tab: tickets you've viewed lately, on any site | – |
| [SLA Countdown](sla-countdown.md) | Time left to first response and resolution, on tabs and in an ⏱ SLA tab | Freshservice API |
| [Ticket Notifications](ticket-notifications.md) | Desktop alert when a ticket assigned to you gets a reply | Freshservice API |
| [Ticket Search](ticket-search.md) | 🔎 Search tab: find tickets by number, subject or requester | Freshservice API |

### Notes & Replies

| Plugin | What it does | Needs |
|---|---|---|
| [Note Backup](note-backup.md) | 📋 Notes tab: draft notes with autosave, snapshots, templates and live sync | a site plugin, for sync |
| [Canned Responses](canned-responses.md) | 💬 Replies tab: saved replies with placeholders | a site plugin for inserting |

### Time & Reminders

| Plugin | What it does | Needs |
|---|---|---|
| [Time Tracker](time-tracker.md) | ⏱ Time tab: a timer per ticket that logs time entries | Freshservice API or ConnectWise to log |
| [Follow-up Reminders](follow-ups.md) | ⏰ Follow-ups tab: be reminded about a ticket later | – |

### AI

| Plugin | What it does | Needs |
|---|---|---|
| [AI Features](ai-features.md) | ✨ Suggest and 📋 Summarize buttons in the Notes tab | an AI provider, Note Backup |
| [AI Assistant](ai-assistant.md) | 🤖 Assistant tab: a general AI chat that looks up tickets, people and assets in Freshservice to answer questions (read-only) | AI Features, Freshservice API |
| [Solutions Chat](solutions-chat.md) | 📚 Solutions tab: ask questions answered from your Freshservice Solutions articles | AI Features, Freshservice API |

### Tabs & Toolbars

| Plugin | What it does | Needs |
|---|---|---|
| [Bookmarks Bar](bookmarks-bar.md) | A row of bookmarks under the address bar | – |
| [Metrics Bar](metrics-bar.md) | Live numbers from dashboards (or Freshservice counts) above the tab bar | – |
| [Tree Style Tabs](tree-tabs.md) | 🌲 Tree tab: your tabs as a tree with groups | – |

### Security

| Plugin | What it does | Needs |
|---|---|---|
| [Password Vault](password-vault.md) | 🔑 Vault tab: your passwords, encrypted with a master password, with Windows Hello and auto-fill | – |

## Installing and managing plugins

All of this is under **Settings → Plugins**.

- **Install** – Open **Browse**, find a plugin and click **Install**. Plugins it needs are installed with it. Restart to load it (**Restart Now**).
- **Turn off** – Untick a plugin in the Installed list, or use the **Enabled** switch at the top of its settings tab. Its settings and data are kept.
- **Remove** – Click **Remove**. Its saved data is kept unless you tick **Also delete its saved data**. Removing a plugin that another one needs warns you first.
- **Import** – **Import Plugin File** installs a `.mspplugin` package; **Import Folder** installs a plugin folder. Importing a plugin that's already installed replaces it. Imported plugins show an **Imported** badge.
- **Filter** – The lists are grouped by category (click a heading to collapse it), with an All / On / Off filter.

Every install, update and removal happens at the next start, because a running plugin can't be unloaded.

### Updates

MSP++ checks the directory 30 seconds after it starts, then once a day, or when you click **Check Now**. When updates are waiting you get a count on Plugins and Browse, an **Update All** button and a notification. Turn on **Install Plugin Updates Automatically** to download them without asking.

Plugins can be marked **pre-alpha**, **alpha**, **beta** or **RC** when they're not finished yet, shown as a coloured badge. **Update Plugins To** (beta or better by default) decides which of those updates you're offered. See [Plugin release stages](../plugin-release-stages.md).

Each download is checked against the size and SHA-256 listed in the directory before it's unpacked.

Plugin versions match the app release they belong to. A fix to a plugin between app releases gets a fourth number, so `0.8.7.1` is a fix to the plugin that came with MSP++ 0.8.7. Those need MSP++ 0.8.7 or later: older copies don't see them in Browse until the app is updated. See [Plugin version numbers](../plugins.md#plugin-version-numbers).

### Where plugins and their data live

Plugin code goes in `installed-plugins\<id>\` and each plugin's data in `plugins\<id>\`, both in the [data folder](../data-files.md#the-data-folder). Some plugins keep their settings in `settings.json` instead. Each plugin page has a **Data** section, and [Files and folders](../data-files.md) lists everything.

## Writing your own

See the [Plugin development guide](../plugins.md) and, for a new ticketing site, [Site plugins](../sites.md).
