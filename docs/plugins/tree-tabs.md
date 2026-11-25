# Tree Style Tabs

[Docs home](../README.md) › [All plugins](README.md) › Tree Style Tabs

**Stage:** [Beta](../plugin-release-stages.md) · **Category:** Tabs & Toolbars · **Side panel tab:** 🌲 Tree · **Needs:** nothing

Shows your open tabs as a tree in the side panel: named groups, tabs under a master tab, nested as deep as you like.

## Using it

- **Groups** – **＋ Group** makes a named group (a folder for tabs). Double-click a group to rename it, or right-click a tab in the tab bar and choose **🌲 Move to New Group**.
- **Master tabs** – Any tab can have child tabs, and groups can hold groups. Right-click a tab and choose **Name This Tab…** to give it a name of its own.
- **Drag to arrange** – Drop a row on the middle of another to put it underneath, or near its top or bottom edge to put it next to it. Drop below the last row to move it to the top level.
- **Links nest automatically** – A tab opened from a link (or **Open Link in New Tab**) goes under the tab it came from.
- **Close** – Click a tab to switch to it; middle-click or × closes it, and its children move up a level. Right-click for **Close Tab and Its Children** or **Close Group and Its Tabs** (both ask first), **Ungroup (Keep Tabs)**, **Move Up a Level** and more.
- **Find your way** – Filter the tree by title or address, collapse or expand groups (or all of them), and use the arrow keys, `Enter`, `F2` (rename) and `Delete` in the tree.

## Settings

**Settings → Plugins → Tree Style Tabs**

| Setting | What it does | Default |
|---|---|---|
| Put tabs opened from a link under the tab they came from | Off: every new tab goes at the top level. | On |

## Data

`plugins\tree-tabs\tree.json` in the [data folder](../data-files.md#plugin-data-datapluginsplugin-id).

## Limits and known issues

- The tree is a view in the side panel; the tab bar keeps its own order.
- After a restart, the tree is matched to the restored tabs by address.

## See also

- [The side panel](../side-panel.md)
- [Bookmarks Bar](bookmarks-bar.md)
