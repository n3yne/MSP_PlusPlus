# Updates and notifications

[Docs home](README.md) › Updates and notifications

The bell in the tab bar shows a badge when there are unread notifications. Click it to see them.

## Updates

MSP++ checks GitHub Releases when it starts and every 6 hours.

- **Installed Windows app** – Downloads new versions in the background and shows **Update Ready** with a **Restart to Update** button. If you don't restart, the update installs the next time you close MSP++.
- **Ask first** – Turn off **Settings → General → Download Updates Automatically** to be asked before anything downloads. **Check for Updates** there checks now.
- **Portable .exe and Mac app** – Can't update themselves. They show **Update Available** with a link to the release.
- **Microsoft Store app** – Updated by the Store. MSP++ doesn't check GitHub. See [Microsoft Store build](microsoft-store.md).
- **Hide for now** and **Don't remind me for this version** quiet a notice.

Installed copies on 0.7.0 or earlier need one manual install of a newer version before automatic updates work.

Plugins update separately, from the plugin directory. By default only updates that are **Beta or better** are offered; see [Plugin updates](plugins/README.md#updates) and [Plugin release stages](plugin-release-stages.md).

## App notifications

| Notification | When |
|---|---|
| Update Ready / Update Available | A new version is out (above). |
| Plugin updates | Installed plugins have newer versions in the directory. |
| Auto-save failed | A note couldn't be written to disk ([Note Backup](plugins/note-backup.md)). |
| Backup storage warning | The backup folder is bigger than the limit set in [Note Backup](plugins/note-backup.md#settings). |
| Live sync push failed | The first push to a site's note field failed, for example because the session expired. |

Plugins add their own: new ticket replies ([Ticket Notifications](plugins/ticket-notifications.md)), due reminders ([Follow-up Reminders](plugins/follow-ups.md)) and SLA alerts ([SLA Countdown](plugins/sla-countdown.md)). Some of these also show a Windows desktop notification; if one doesn't appear, check that notifications are on for MSP++ in Windows Settings → System → Notifications.

## See also

- [Getting started](getting-started.md#install-on-windows): installer vs portable
- [Troubleshooting](troubleshooting.md)
