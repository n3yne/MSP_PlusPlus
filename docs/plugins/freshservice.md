# Freshservice

[Docs home](../README.md) › [All plugins](README.md) › Freshservice

**Stage:** [Stable](../plugin-release-stages.md) · **Category:** Sites · **Needs:** nothing · **Used by:** most other plugins

The Freshservice site plugin is what makes MSP++ understand Freshservice pages. It finds the ticket in each tab, connects the [Notes tab](note-backup.md) to Freshservice's note editor, and provides the Freshservice API that Ticket Search, Quick Actions, SLA Countdown, Ticket Notifications, Solutions Chat, Time Tracker and the Metrics Bar use.

## What it does

- **Ticket detection** – Reads the record number from the address (`/a/tickets/1234`). Changes, problems and releases are tracked too, as `CHN-45`, `PRB-12` and `RL-3`, so they never collide with ticket numbers.
- **Note sync** – Lets [Note Backup](note-backup.md#live-sync) keep the Notes tab and the open **Add note** / **Reply** editor (or a note box such as the time-entry form) in step as you type. With several editors open, the one you last clicked into is used.
- **Reply box** – Lets [Canned Responses](canned-responses.md) insert replies at the cursor.
- **Ticket details** – Gives [AI Features](ai-features.md) the subject, status, requester, description and every reply and note, through the API when it's set up and from the page otherwise.
- **Hover preview** – Rest the mouse on a ticket in the [Recent](recent-tickets.md) or [Search](ticket-search.md) tab to see its status, requester, agent and latest reply (needs the API).
- **Hosts** – Covers `*.freshservice.com`, `*.freshworks.com` and `*.myfreshworks.com`, plus your API domain, your [alias host](#alias-host) and the Home URL's host. Those get a Chrome user agent and sign-in popups in real windows.

## The Freshservice API

Many features read and change tickets through the Freshservice REST API (v2). To set it up, open **Settings → Plugins → Freshservice**:

1. Tick **Read ticket details through the API**.
2. Enter your **Freshservice Domain**, such as `yourcompany.freshservice.com`.
3. Paste your **API Key**. Find it in Freshservice under your profile → **Profile Settings** → **API Key**.
4. Click **Test connection**.

Everything done through the API is done as the agent the key belongs to. That agent needs permission for what each feature does:

| Feature | Permission the key's agent needs |
|---|---|
| [AI Features](ai-features.md) Summarize and Suggest | View tickets |
| [Ticket Search](ticket-search.md) | View tickets and requesters |
| [Quick Actions](quick-actions.md) | Edit tickets, list agents and groups |
| [Time Tracker](time-tracker.md) logging | Add time entries |
| [SLA Countdown](sla-countdown.md), [Ticket Notifications](ticket-notifications.md) | View tickets |
| [Solutions Chat](solutions-chat.md) | View Solutions articles |
| [AI Assistant](ai-assistant.md) | View tickets, requesters, agents, groups, assets, problems, changes and Solutions articles (whatever it is asked about) |
| [Metrics Bar](metrics-bar-api-queries.md) counts | View tickets |

**Fallback:** if the API is turned off, not set up, rate-limited or returns an error, or the record is a change, problem or release, features that can read the page do so instead.

**Key safety:** the key is encrypted with the operating system's credential storage, never sent to the main window, and only sent to the configured domain over https. It's tied to the domain it was entered for: change the domain and you'll need to enter the key again. **Remove key** deletes it.

## Alias host

If your company reaches Freshservice through its own address (such as `service.yourcompany.com` for `yourcompany.freshservice.com`), enter both under **Settings → Plugins → Freshservice → Alias Host**:

- **Alias host** – your company's address.
- **Freshservice host** – the real `*.freshservice.com` host.

Pages opened on the alias load from the Freshservice host instead, with the path, query and `#` unchanged. Form posts to the alias (such as a sign-in response) and API calls to the domain above are left as they are.

## Settings

| Setting | What it does | Default |
|---|---|---|
| Read ticket details through the API | Use the API at all. Off: read pages only. | On |
| Freshservice Domain | Your instance, for the API. | empty |
| API Key | Your Freshservice API key (stored encrypted). | empty |
| Alias host / Freshservice host | See [Alias host](#alias-host). | empty |

## Data

Settings live in `settings.json`; the key is stored encrypted there. The plugin keeps no files of its own. See [Files and folders](../data-files.md).

## Limits and known issues

- The live note editor only exists after you click **Add note** or **Reply**, so sync waits for that.
- Freshservice's API can't search ticket subjects; see [Ticket Search](ticket-search.md#limits-and-known-issues) for how MSP++ works around it.
- Filter queries compare dates as whole days in UTC.
- Some features (Ticket Search, hover preview, AI ticket text) show only the standard statuses (Open, Pending, Resolved, Closed); custom statuses may show blank there. [Quick Actions](quick-actions.md) lists custom statuses.
- Quick Actions and SLA Countdown work on tickets only, not changes, problems or releases.

## See also

- [ConnectWise Manage](connectwise-manage.md), the other site plugin
- [Site plugins](../sites.md), for developers
- [Troubleshooting → Sites and sign-in](../troubleshooting.md#sites-and-sign-in)
