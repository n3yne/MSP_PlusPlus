# Getting started

[Docs home](README.md) › Getting started

## Install on Windows

### From the Microsoft Store

Get MSP++ from its [Microsoft Store page](https://apps.microsoft.com/detail/9NVJX5HK84G2). Microsoft signs the Store copy, so Windows and Defender trust it, and the Store installs updates. Some differences, such as where new files are kept, are in [Microsoft Store build](microsoft-store.md#whats-different-in-the-store-copy). Each GitHub release links to the Store page too.

### From GitHub

Each release on the [Releases page](https://github.com/n3yne/MSP_PlusPlus/releases) has two Windows downloads:

| Download | What it is |
|---|---|
| `MSP-PlusPlus-Setup-<version>.exe` | **Installer.** Asks whether to install just for you (`%LOCALAPPDATA%\Programs\MSP++`, no admin rights) or for everyone on the PC (`C:\Program Files\MSP++`, needs admin), and lets you change the folder. Adds Start menu and desktop shortcuts. Later installers reuse the folder you picked the first time. The installed app [updates itself](updates-and-notifications.md#updates). |
| `MSP++ <version>.exe` | **Portable.** Runs from wherever you put it; nothing is installed. It tells you when a new version is out but can't update itself. |

Both use the same [data folder](data-files.md#the-data-folder), so you can switch between them. Uninstall from Windows Settings → Apps; your data folder is kept.

A macOS `.dmg` can be built from source (see [Building from source](building.md)).

## First start: choose your plugins

MSP++ comes with no plugins built in. The first time it starts (or whenever no site plugin is installed), it opens **Choose your plugins**:

1. Tick the site(s) you work in: [Freshservice](plugins/freshservice.md), [ConnectWise Manage](plugins/connectwise-manage.md), or both.
2. Tick any optional plugins. Plugins that another one needs are ticked with it. See [All plugins](plugins/README.md) for what each one does.
3. Click **Install**. MSP++ restarts with them.

If you updated from 0.8.0 or earlier, the plugins you were using are already ticked, and your settings, notes and plugin data are kept.

With no internet connection you can **Try again**, **Install from file…** (a `.mspplugin` package), or **Skip for now**. Skipping asks again at the next start unless you tick **Don't ask again**.

You can add or remove plugins at any time later under **Settings → Plugins** ([how](plugins/README.md#installing-and-managing-plugins)).

## Set the Home URL and sign in

1. Open **Settings** (`Ctrl+,`) → **General** and set **Home URL** to the page new tabs should open, such as `https://yourcompany.freshservice.com/` or your ConnectWise Manage address.
2. Open a tab and sign in once. Sign-ins are kept between launches.

## Next steps

- If you use Freshservice, set up [the Freshservice API](plugins/freshservice.md#the-freshservice-api). Ticket Search, Quick Actions, SLA Countdown, Ticket Notifications, Solutions Chat and Time Tracker logging all need it.
- Learn the [keyboard shortcuts](keyboard-shortcuts.md), especially `Ctrl+K` for the [command palette](browser.md#command-palette).
- Moving from another PC? See [Move settings to another PC](settings.md#move-settings-to-another-pc).

> MSP++ was called **Freshservice++** before 0.6.0. Your settings, notes and sign-ins carry over: the app keeps using the existing Freshservice++ data folder.
