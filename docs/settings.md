# Settings

[Docs home](README.md) › Settings

Open Settings with `Ctrl+,` or **Edit → Settings**. It opens in its own window, so the main window stays usable. Pressing the shortcut again brings the existing window forward.

The left-hand list has **General** and **Plugins**, with a tab for every installed plugin under Plugins. Each plugin's own settings are described on its page (see [All plugins](plugins/README.md)). Changes are saved straight away and applied to the main window.

## General

| Setting | What it does |
|---|---|
| **Home URL** | The page new tabs open. Starts as the Freshservice sign-in page when the Freshservice plugin is installed. |
| **Restore Tabs from Last Session** | Reopens the tabs you had open. Off: start on the Home URL (pinned tabs still come back). |
| **Unread Badge on Tabs** | Shows a dot on a background tab whose page changed on its own. |
| **Colour Tabs by Site** | A coloured stripe on tabs that belong to a site plugin. See [Tab colours](#tab-colours). |
| **Light Mode** | Light theme instead of dark. |
| **Side Panel** | Shows the [side panel](side-panel.md). |
| **Scroll Side Panel Tabs** | Keeps side panel tabs on one scrolling row instead of wrapping. |
| **Download Updates Automatically** | See [Updates](updates-and-notifications.md#updates). |
| **Site Permissions** | See [Site permissions](#site-permissions). |
| **Move Settings to Another PC** | See [below](#move-settings-to-another-pc). |

### Tab colours

Each site plugin brings a colour (Freshservice green, ConnectWise Manage orange). Under **Colour Tabs by Site** you can pick another colour for each site, turn the stripe off for one site, or reset it to the site's own colour. Turning the setting off removes every stripe.

### Site permissions

When a site asks to use the microphone, camera, location, notifications or clipboard, your **Allow** or **Block** answer is saved for that site. Click **Forget Saved Answers** to be asked again. The answers live in `site-permissions.json` (see [Files and folders](data-files.md#app-files-datanote-backups)).

## Plugins

**Settings → Plugins** lists installed plugins by category, with a **Browse** list of plugins you can install. How to install, update, import and remove plugins is on [All plugins](plugins/README.md#installing-and-managing-plugins).

Every plugin has an **Enabled** switch at the top of its settings tab. Plugin changes need a restart; Settings shows **Restart Now**.

## Move settings to another PC

Under **Settings → General → Move Settings to Another PC**:

- **Export Settings…** saves your app and plugin settings, bookmarks, canned responses and which plugins are on to a `.json` file.
- **Import Settings…** on the other PC loads it.

API keys are never in the file: they're encrypted for this PC and couldn't be read elsewhere, so enter them again on the new PC (importing keeps any keys already saved there). Notes, timers, reminders and other plugin data aren't included; to move those, copy the [data folder](data-files.md#the-data-folder).

## Window

The main window reopens at its last size and position, checked against your connected screens so it never opens off-screen.

## See also

- [Files and folders](data-files.md): where settings are stored (`settings.json`)
- [Updates and notifications](updates-and-notifications.md)
