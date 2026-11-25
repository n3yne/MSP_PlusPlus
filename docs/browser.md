# The browser

[Docs home](README.md) › The browser

MSP++ is a tabbed browser built for ticketing sites. This page covers what the app does on its own, without plugins. For the panel on the right, see [The side panel](side-panel.md).

## Tabs

- **Restore tabs** – The tabs you had open come back the next time the app starts. Turn off **Settings → General → Restore Tabs from Last Session** to start on the Home URL instead (pinned tabs always come back).
- **Unread dot** – A dot marks a background tab whose page changed on its own (a new reply changing the title, for example) until you switch to it. Turn it off with **Settings → General → Unread Badge on Tabs**.
- **Site colours** – A thin stripe along the top of each tab shows which site it's on (green for Freshservice, orange for ConnectWise Manage). Change or turn off the colours in [Settings](settings.md#tab-colours).
- **Right-click a tab** to pin, duplicate (the copy opens next to the original), close others, reopen closed tabs, copy the URL, copy a clean ticket link, open in your default browser, or **Open in New Window**. Plugins add their own items here, such as **⏱ Start Timer for This Ticket** from [Time Tracker](plugins/time-tracker.md).
- **New tab** – `Ctrl+T`, or double-click an empty part of the tab bar.
- **Links in a new tab** – Middle-click or `Ctrl`+click a link on a page to open it in a new tab. MSP++ switches to the new tab; turn on **Settings → General → Middle-Click Opens Links in Background** to stay on the tab you're on instead.
- **Reopen** – `Ctrl+Shift+T` puts the last closed tab back where it was.
- **Refresh all** – **View → Refresh All Tabs** (`Ctrl+Alt+R`).
- **Crashed tabs** – If a tab's page dies, the tab says so and offers to reload it instead of going blank.

Tab shortcuts work while you're typing in a page too. The full list is in [Keyboard shortcuts](keyboard-shortcuts.md).

## Address bar

The row under the tab bar shows the active tab's address, with back, forward and reload beside it.

- Type an address and press `Enter`. `Ctrl+L` jumps to the bar, `Escape` puts the page's address back.
- Only `http` and `https` pages open. A bare host such as `example.com` gets `https://` added. There is no web search, so plain words are ignored.
- **Type a ticket number to jump to it:** `12345` (or `INC-12345`, `CHN-45`, `PRB-67`, `RL-89`) opens it in Freshservice, and `CW-12345` opens a ConnectWise Manage ticket. A bare number goes to the site of the tab you're on. The instance is taken from an open tab on that site (for Freshservice, also the API domain or Home URL), so ConnectWise needs a CW tab open.

## Command palette

`Ctrl+K` (or **View → Command Palette**) opens a search box over the page. Type to find:

- an open tab, a bookmark, a side panel tab, a setting or an app command,
- a recently viewed ticket (from [Recent Tickets](plugins/recent-tickets.md)),
- tickets matching words from a subject or a requester's name (from [Ticket Search](plugins/ticket-search.md)), added as they arrive,
- plugin commands, such as **Assign Ticket to Me** from [Quick Actions](plugins/quick-actions.md) or **Follow up** from [Follow-up Reminders](plugins/follow-ups.md).

A ticket number (`12345`, `CW-12345`) or an address opens straight away, as in the address bar. `Ctrl+Enter` opens a ticket, address or bookmark in a new tab.

`Ctrl+K` works even while a page has focus, so in a ticket's reply editor it opens the palette instead of the editor's insert-link shortcut. Use the editor's link button instead.

## Open in New Window

Right-click a tab and choose **Open in New Window** for a plain browser window: back, forward, reload and an address bar, with no tabs, side panel, metrics or bookmarks. It shares your sign-ins and closes when the main window closes. Links it opens go to tabs in the main window, and the ⇱ button moves its page to a tab. Right-clicking a link in a page also offers **Open Link in New Window**.

To keep these windows in front of everything else (handy for a ticket you're copying from), turn on **Settings → General → Keep Pop-Out Windows on Top**. It's off by default, and changing it also applies to windows already open.

## Page zoom

`Ctrl`+mouse wheel, `Ctrl+=` / `Ctrl+-`, or **View → Zoom In / Zoom Out** zooms the page in the active tab. The app's own toolbar and side panel stay the same size. Zoom is kept per site, so other tabs on the same site follow along. When a tab isn't at 100%, its zoom level shows at the end of the address bar; click it or press `Ctrl+0` to reset.

## Find in page

`Ctrl+F` searches text on the current page, even on sites that use `Ctrl+F` for their own search. Press it again to select the search text, `Escape` to close.

## Downloads and images

- **Download manager** – Tracks in-progress and finished downloads, with open and show-in-folder actions. A badge on the download icon counts files finished since you last opened it. The list is cleared on restart.
- **Images** – Right-click an image for **Copy Image** and **Save Image As…**. Image links download instead of opening new tabs.

## Sign-ins, passkeys and permissions

- **Passkeys** – Sites that offer "sign in with a passkey" (Microsoft sign-in, for example) work in tabs. On Windows, the Windows Hello prompt handles this PC's passkeys, security keys and phones (scan the QR code). When a security key holds several accounts for a site, the app asks which one to use. Microsoft's sign-in pages are always sent a plain Chrome user agent (app 0.8.9 and later), because Microsoft hides the passkey option from browsers it doesn't recognise. On a company Windows PC, [Use Windows Device Sign-On](settings.md#general) (on by default) also lets Microsoft accept your Windows sign-in, as Edge does, when your organisation requires a passkey or a company device.
- **Permission prompts** – A site has to ask before it uses the microphone, camera, location, notifications or clipboard, or opens a link in another program. Harmless permissions (such as copying to the clipboard) are allowed without asking. Your **Allow** or **Block** answer is saved per site; see [Settings → Site permissions](settings.md#site-permissions) to reset them.
- **Password managers** – Browser password manager extensions aren't supported. Use your desktop password manager's auto-type instead.

## See also

- [The side panel](side-panel.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Troubleshooting](troubleshooting.md)
