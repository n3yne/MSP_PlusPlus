# Canned Responses

[Docs home](../README.md) › [All plugins](README.md) › Canned Responses

**Category:** Notes & Replies · **Side panel tab:** 💬 Replies · **Needs:** a [site plugin](README.md#sites) to insert into the reply box (Copy works anywhere)

Saved replies you can drop into a ticket in one click, with placeholders for the requester, ticket and your name.

## Using it

- **Insert** – Open the 💬 Replies tab and click a reply. It goes in at the cursor in the ticket's reply box: the [Freshservice](freshservice.md) reply or note editor, or the [ConnectWise Manage](connectwise-manage.md) notes editor. Nothing already in the box is replaced.
- **Search** – Type in the search box and press `Enter` to insert the top match, or use the arrow keys to pick another.
- **Copy** – Puts the filled-in reply on the clipboard, for sites without reply box support.
- Replies are grouped by category.

### Placeholders

| Placeholder | Filled with |
|---|---|
| `{{requester}}` / `{{requester_first}}` | The requester's name / first name |
| `{{subject}}` | The ticket subject |
| `{{ticket}}` | The ticket number |
| `{{agent}}` / `{{agent_first}}` | Your name / first name (from Settings) |
| `{{date}}` / `{{time}}` | Today's date / the time now |
| `{{site}}` | The site, e.g. Freshservice |

On Freshservice the requester and subject come from [the API](freshservice.md#the-freshservice-api) when it's set up, otherwise from the page. Any placeholder that can't be filled is left as it is, and the panel tells you which ones to fill in.

## Settings

**Settings → Plugins → Canned Responses**

| Setting | What it does | Default |
|---|---|---|
| Your name | Used for `{{agent}}` and `{{agent_first}}`. | empty |
| Replies | Add, edit, delete and reorder replies. Each has a name, an optional category and the text. | none |

## Data

Replies are stored in `settings.json`, so [Export Settings](../settings.md#move-settings-to-another-pc) takes them to another PC.

## Limits and known issues

- Up to 200 replies, each up to 10,000 characters.
- Replies are plain text with placeholders; there's no rich formatting.
- Inserting needs the site's reply box to be open on the page.

## See also

- [Note Backup](note-backup.md) for longer notes and templates
