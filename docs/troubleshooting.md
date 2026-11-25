# Troubleshooting

[Docs home](README.md) › Troubleshooting

Problems with one plugin are also covered on that plugin's page, under **Limits and known issues**.

## Sites and sign-in

- **Freshservice doesn't load** – The app sends a standard Chrome user agent to `*.freshservice.com`, `*.freshworks.com` and `*.myfreshworks.com`. Check you can reach your instance, and set it (e.g. `https://yourcompany.freshservice.com/`) as the **Home URL** in [Settings → General](settings.md#general). If you reach Freshservice through your own address, see [Alias host](plugins/freshservice.md#alias-host).
- **ConnectWise Manage doesn't load** – The same Chrome user agent goes to `*.myconnectwise.net` and to the [Custom URL](plugins/connectwise-manage.md#settings) host. Check that the ConnectWise Manage plugin is installed and enabled in Settings → Plugins.
- **Signed out every time** – Sign-ins are kept in the browser profile in the [data folder](data-files.md#browser-profile-data). Cleanup tools that clear `Cookies` sign you out.
- **Microsoft says "You can't get there from here … you are required to sign-in with your passkey … but this app doesn't support it"** – Your organisation requires a passkey for that account, and Microsoft didn't recognise the app as a browser that can use one. Update to 0.8.10 or later, which presents Microsoft's sign-in pages with a Chrome user agent. If it still appears, your admins can see the reason in the Entra sign-in logs for that attempt (user agent and the Conditional Access policy that blocked it).
- **Passkey sign-in doesn't offer Touch ID on macOS** – Touch ID passkeys need a signed build, which the macOS build doesn't have yet. USB security keys still work. On Windows, passkeys go through Windows Hello: check it's set up under Windows Settings → Accounts → Sign-in options.
- **Copilot sign-in fails with error 53000 ("device is required to be managed")** – Your company only allows sign-in from a managed PC. On Windows with MSP++ 0.8.6 or later, check **Use Windows Device Sign-On** is on in [AI Features settings](plugins/ai-features.md#settings), then **Sign out** and **Open and sign in** again. It only works on a PC registered with your company's Microsoft Entra ID. See [Windows device sign-on](plugins/ai-providers.md#copilot-website).
- **A site says the microphone, camera or location is blocked** – You chose **Block** for that site earlier. Click **Forget Saved Answers** under [Settings → General → Site Permissions](settings.md#site-permissions) and reload the page.

## Notes and sync

- **Live sync not working** – Freshservice only shows a note editor after you click **Add note** or **Reply**, so open one first. On ConnectWise Manage, open a time entry or the stopwatch. The status pill at the bottom of the Notes tab shows the state (`⇅ Synced`, `⇅ Pushing…`, `⇅ No notes field`). See [Note Backup → Live sync](plugins/note-backup.md#live-sync).
- **Ticket number not detected** – Freshservice detection uses the record URL (`/a/tickets/<id>`, `/a/changes/<id>`, …); ConnectWise uses the URL or the ticket page. You can type an ID into the **Ticket / Reference ID** box by hand.

## API features

- **Freshservice API or Azure OpenAI stopped working after changing the domain or endpoint** – Saved keys only work with the address they were entered for. Paste the key again.
- **A Freshservice feature says it isn't set up** – Ticket Search, Quick Actions, SLA Countdown, Ticket Notifications, Solutions Chat and Time Tracker logging need [the Freshservice API](plugins/freshservice.md#the-freshservice-api). Click **Test connection** there.

## Metrics Bar

- **Shows `—` or `(not found)`** – Click **Test selectors** next to the dashboard. If a field still isn't found, use **Re-pick** on it. See [Metrics Bar](plugins/metrics-bar.md#limits-and-known-issues).
- **Shows `⚠` on a card** – The last refresh for that field failed; the value is the last one that worked. Hover the `⚠` to see when that was. It retries at the next refresh.

## Updates and plugins

- **No automatic update** – Only the installed Windows app updates itself. The portable .exe and the Mac app show **Update Available** with a link. Installed copies on 0.7.0 or earlier need one manual install first. See [Updates](updates-and-notifications.md#updates).
- **A plugin change didn't take effect** – Plugins load at start-up. Click **Restart Now** in Settings.
- **Windows notifications don't appear** – Check that notifications are on for MSP++ in Windows Settings → System → Notifications. Notifications under the bell show either way.

## Anything else

Press `Ctrl+Shift+I` to open the developer tools and check the console for errors. MSP++ doesn't write log files ([Files and folders](data-files.md#logs)).
