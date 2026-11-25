# Plugin release stages

[Docs home](README.md) › [All plugins](plugins/README.md) › Plugin release stages

*MSP++ 0.8.10 and later.*

A plugin version can be marked with how finished it is, so you know what you're getting into before you install it, and so you can choose to take updates only once they're finished enough for you.

## The stages

| Stage | Badge | What it means |
|---|---|---|
| **Pre-alpha** | red | An early experiment. Expect missing features and bugs. It may change a lot or be dropped. |
| **Alpha** | orange | The main features are there but barely tested. Expect bugs. |
| **Beta** | yellow | Feature-complete and being tested. Some bugs are likely. |
| **RC** (release candidate) | blue | Expected to become the stable version unless a problem turns up. |
| **Stable** | none | Tested and ready for everyday use. |

The badge shows next to the version number in **Settings → Plugins** (Installed and Browse), in each plugin's settings tab, in the first-start plugin picker, and in the plugin update notification. Hover over a badge to see what it means. Stable plugins have no badge.

## Choosing which updates you get

**Settings → Plugins → Browse → Update Plugins To** sets the lowest stage an update has to be at before MSP++ offers it:

- **Stable only**
- **RC or better**
- **Beta or better** (the default from 0.8.11; 0.8.10 started on Stable only)
- **Alpha or better**
- **Everything (including pre-alpha)**

When a new version is below your choice:

- It isn't counted in the update badge, isn't in **Update All**, doesn't get a notification, and isn't downloaded by **Install Plugin Updates Automatically**.
- You stay on the version you have. The directory only lists each plugin's newest version, so you get the next update once a version at your stage comes out.
- Browse still lists it as **Below your update stage**, with a button to install it anyway.

### For one plugin

Each directory plugin's settings tab has an **Updates** choice under its on/off switch. Leave it on **Use default** to follow **Update Plugins To**, or pick a stage for that plugin only. For example, keep everything on **Beta or better** but take **Alpha or better** for one plugin you're helping to test.

## Installing a plugin that isn't stable

You can install a plugin at any stage. **Update Plugins To** only decides which updates are offered automatically. In Browse, installing or updating to a version below stable asks you to confirm first. In the first-start plugin picker, plugins below stable start unticked, even ones you used before. Tick them if you want them.

## Each plugin's stage

Set in 0.8.11. A stage changes when a plugin is tested enough to move up.

| Stage | Plugins |
|---|---|
| Stable | [Freshservice](plugins/freshservice.md), [Metrics Bar](plugins/metrics-bar.md), [Bookmarks Bar](plugins/bookmarks-bar.md) |
| Beta | [ConnectWise Manage](plugins/connectwise-manage.md), [Note Backup](plugins/note-backup.md), [Recent Tickets](plugins/recent-tickets.md), [Ticket Search](plugins/ticket-search.md), [Quick Actions](plugins/quick-actions.md), [SLA Countdown](plugins/sla-countdown.md), [Ticket Notifications](plugins/ticket-notifications.md), [Canned Responses](plugins/canned-responses.md), [Time Tracker](plugins/time-tracker.md), [Follow-up Reminders](plugins/follow-ups.md), [Tree Style Tabs](plugins/tree-tabs.md) |
| Alpha | [AI Features](plugins/ai-features.md), [AI Assistant](plugins/ai-assistant.md), [Solutions Chat](plugins/solutions-chat.md), [Password Vault](plugins/password-vault.md) |

With the default **Beta or better**, the alpha plugins don't update automatically. Install their updates from Browse, or set them to **Alpha or better** in their settings tabs.

## For plugin authors

Set `"stage"` in the plugin's `manifest.json`:

```json
{
  "id": "my-plugin",
  "version": "0.8.10.1",
  "stage": "beta"
}
```

- Allowed values are `pre-alpha`, `alpha`, `beta`, `rc` and `stable`, written exactly like that. The publish build (`scripts/build-plugin-directory.js`) refuses anything else.
- If you leave `stage` out, the plugin counts as stable. Every plugin published before stages existed stays stable.
- The build copies the stage into the directory's `index.json`, but only when it isn't stable.
- The stage belongs to the version. To move a plugin from beta to stable, change `stage` and bump the version, because a published version can't change.
- **Older apps ignore the stage.** MSP++ 0.8.9 and earlier offer every update to everyone, whatever its stage. Set `"minAppVersion": "0.8.10"` on a version below stable if it must not reach those copies.

Code: `src/shared/plugin-stages.js` (stage list, labels and the per-plugin lookup), used by `plugin-directory.js` (which updates are held back), the settings window and the first-start picker.

Settings (in `settings.json`):

| Key | Default | Meaning |
|---|---|---|
| `pluginUpdateStage` | `"beta"` | The lowest stage for updates (`"stable"` in 0.8.10). |
| `pluginUpdateStageOverrides` | `{}` | `{ "<plugin id>": "<stage>" }` for plugins that don't follow the default. |

A settings import that would change `pluginUpdateStage` lists it in the import prompt before applying it.

## See also

- [All plugins: Updates](plugins/README.md#updates)
- [Plugin version numbers](plugins.md#plugin-version-numbers)
- [Publishing a plugin to the directory](plugins.md#publishing-a-plugin-to-the-directory)
