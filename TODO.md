# MSP++ to-do list

Features and fixes to work on next. Tick a box when it's done (or delete the line once it has shipped in a release), and add new ideas and bugs to the right section as they come up.

Outside of pressing bug fixes, items are picked up one at a time. Each idea has a one-line reason; delete any that stop making sense.

Ground rules for new work: the core app stays site-agnostic, features go in plugins, and every new or changed plugin gets its page in [docs/plugins/](docs/plugins/README.md).

## Testing on Windows (0.8.8)

Most of the app has only been run through automated tests and the Linux dev build. These need a real Windows PC and a real account.

- [ ] Copilot website **Send Automatically** (AI Features 0.8.7.1, hands-off mode through DevTools input). Earlier attempts failed live.
- [ ] Password Vault auto-fill (0.8.8.1), including Microsoft's two-step sign-in (email page, then password page).
- [ ] Password Vault **Windows Hello** unlock, and what happens after a Windows Hello PIN reset.
- [ ] Windows device sign-on (the Copilot error 53000 fix). Sign-in has worked once; check it still works after a restart and on a second PC.
- [ ] Installer: "just me" and "all users" installs, then an automatic update from one version to the next.
- [ ] Passkey sign-in and the account chooser.
- [ ] Freshservice **Alias Host** (a custom portal address that points at `yourcompany.freshservice.com`): pages, sign-in, API features.
- [ ] ConnectWise Manage **Custom URL**: Chrome user agent, sign-in pop-ups, note sync.
- [ ] General settings **Middle-Click Opens Links in Background** and **Keep Pop-Out Windows on Top**, plus Bookmarks Bar's own middle-click setting.
- [ ] First-run "Choose your plugins" dialog, and installing, updating and removing plugins from the directory.
- [ ] Each plugin, live, at least once. None of these has been tried against a real site yet:
  - [ ] Freshservice (note sync, Copy Ticket Link, ticket hover preview)
  - [ ] ConnectWise Manage (note sync, CW++ note import)
  - [ ] Note Backup
  - [ ] Canned Responses
  - [ ] Quick Actions
  - [ ] Recent Tickets
  - [ ] SLA Countdown
  - [ ] Ticket Notifications
  - [ ] Ticket Search
  - [ ] Time Tracker (Freshservice logging, ConnectWise fill-in, daily summary)
  - [ ] Follow-up Reminders
  - [ ] Bookmarks Bar
  - [ ] Tree Style Tabs
  - [ ] Metrics Bar (API queries have been tried; dashboard reading and weekly targets haven't)
  - [ ] AI Features and Solutions Chat (through the Copilot website until the Azure app registration is ready)
  - [ ] Password Vault

## Next up

- [x] **Code audit of everything since 0.8.2.** Done in the 24 November audit; fixes in #93 and #94.
- [ ] **Fix: Quick Actions "Set Ticket Status: …" palette items never appear.** The plugin registers its `Ctrl+K` provider with the id `quick-actions.set`, but the core only accepts letters, digits, `-` and `_`, so the call throws (one of the `commands.addProvider: invalid id` messages in the console at start-up). Rename the id or let the core accept dots, and find the second message.
- [x] **Require a reviewer on the `plugin-directory` environment.** Done: plugin publishes now wait for approval.

## Fixes and gaps

- [ ] **show custom ticket statuses everywhere.** Ticket Search, hover previews and AI ticket text show custom statuses as blank; Quick Actions already loads the status list, so the Freshservice plugin could share it.
- [ ] **choose which statuses pause the SLA countdown.** SLA Countdown guesses "on hold" from the status name, which is wrong when a policy keeps counting in Pending.
- [ ] **include saved notes in Export Settings (optional).** Note Backup's notes don't move with settings today, so a new PC starts with none unless the folder is copied by hand.
- [ ] **Password Vault auto-fill inside frames.** Some sign-in pages put the boxes in a frame, where auto-fill can't reach them today.
- [ ] **Password Vault import from CSV** (Bitwarden, KeePass, Chrome and Edge exports). Moving passwords in one at a time is the biggest hurdle to using the vault.
- [ ] **Bookmarks Bar folders and import from Chrome or Edge.** Techs keep dozens of customer portal links, and a flat bar of up to 500 gets crowded.
- [ ] **a log file and a "Copy diagnostics" button.** MSP++ only logs to the developer console, so problems found while testing on Windows are hard to report; a rolling log plus app, plugin and Windows versions in one click would help.
- [ ] **an end-to-end smoke test** that launches the built app (Playwright's Electron support) on the Windows CI runner. Unit tests can't catch a window that fails to open or a plugin that fails to load.

## Feature ideas

- [ ] **ConnectWise Manage API support.** Ticket Search, Quick Actions, SLA Countdown, Ticket Notifications, hover previews and saving time entries are Freshservice only; adding a ConnectWise API adapter to the site plugin (through the existing `pluginAPI.sites` layer) would bring most of them to ConnectWise without changing those plugins much.
- [ ] **run in the system tray and start with Windows** (core, off by default). Follow-up Reminders and Ticket Notifications only work while MSP++ is open, so closing the window means missed alerts.
- [ ] **separate sign-in profiles per tab** (core). MSPs often need two accounts on the same site at once, such as their own Microsoft 365 admin and a customer's tenant, which a single shared sign-in can't do.
- [ ] **Ticket Watchlist plugin.** Pin any ticket (not just ones assigned to you) and get alerted when it changes; useful for escalations, tickets you've handed over, and ones a customer is chasing.
- [ ] **Customer Context plugin.** A side panel tab showing the requester's company, other open tickets from the same company, and their assets, so the history is in view without searching.
- [ ] **Canned Responses text expander.** Type a short trigger like `;vpn` in any text box to insert a reply, instead of only inserting into an open reply box.
- [ ] **Screenshot to note.** Capture the page or a region and paste it into the ticket note in one step, for evidence and handover notes.
- [ ] **search across saved notes.** Note Backup keeps every ticket's notes, but there's no way to find "that fix I wrote last month".
- [ ] **timesheet export from Time Tracker.** A CSV of the daily or weekly summary for timesheets and billing checks.
- [ ] **more site plugins.** Halo PSA, Autotask, and documentation tools like Hudu or IT Glue would grow MSP++ beyond Freshservice and ConnectWise; [Site plugins](docs/sites.md) explains how to add one.

## Waiting on others

- [ ] **Azure app registration** (waiting on the Azure admin). Unlocks the official Azure OpenAI and Microsoft 365 Copilot API for AI Features and Solutions Chat, instead of the Copilot website. See [AI providers](docs/plugins/ai-providers.md).
- [ ] **Code signing**, when a more finished release is ready. The free [SignPath Foundation](https://signpath.org/) program for open-source projects is the likely route; it wants a project with some verifiable reputation first. Until then Windows SmartScreen warns on first install.
