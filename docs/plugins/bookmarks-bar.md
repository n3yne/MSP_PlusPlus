# Bookmarks Bar

[Docs home](../README.md) › [All plugins](README.md) › Bookmarks Bar

**Category:** Tabs & Toolbars · **Needs:** nothing

A row of bookmarked sites under the address bar.

## Using it

- **Save a page** – Right-click a tab and choose **⭐ Save to Bookmarks Bar**, or right-click an empty part of the bar for **Bookmark this page** and **Add bookmark…**.
- **Open** – Click a bookmark to open it in the current tab. Middle-click (or `Ctrl`+click) opens it in a background tab (or switches to the new tab, if you turn off **Middle-click opens bookmarks in background**), `Shift`+click in a [new window](../browser.md#open-in-new-window).
- **Right-click a bookmark** for **Open site**, **Open site in new tab**, **Open site in new window**, **Edit bookmark…** and **Delete bookmark** (which asks first).
- **Reorder** – Drag bookmarks along the bar. Bookmarks that don't fit are under **»** at the end.
- **Command palette** – Bookmarks show up in `Ctrl+K` [search](../browser.md#command-palette).

## Settings

**Settings → Plugins → Bookmarks Bar**

| Setting | What it does | Default |
|---|---|---|
| Show the bookmarks bar | Show or hide the bar (your bookmarks are kept). | On |
| Middle-click opens bookmarks in background | Middle-click or `Ctrl`+click on a bookmark opens a new tab behind the current one. Off: switch to the new tab. Links on pages have a separate setting in [General](../settings.md#general). | On |
| Bookmarks | Every bookmark, with add, edit, delete, move up/down and drag to reorder. | none |

## Data

Bookmarks are stored in `settings.json`, so [Export Settings](../settings.md#move-settings-to-another-pc) takes them to another PC.

## Limits and known issues

- Up to 500 bookmarks. No folders.
- Only `http` and `https` addresses.
- No import from Chrome or Edge.

## See also

- [Tree Style Tabs](tree-tabs.md)
- [The browser](../browser.md)
