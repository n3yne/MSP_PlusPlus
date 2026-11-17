# Solutions Chat

[Docs home](../README.md) › [All plugins](README.md) › Solutions Chat

**Category:** AI · **Side panel tab:** 📚 Solutions · **Needs:** [AI Features](ai-features.md) and [Freshservice](freshservice.md) with [its API](freshservice.md#the-freshservice-api) (installed together)

A chat that answers questions from your Freshservice **Solutions** (knowledge base) articles, and only from them.

## Using it

- **Ask** – Type a question ("how do we reset MFA for a user?"). It searches Solutions, reads the best matches and answers from them, citing each article with a link that opens it in a new tab.
- **🔎 Check this ticket** – Reads the open ticket (through the API, or the page) and looks for an existing documented solution or SOP for it. Leave **Use the open ticket** ticked to give every question the ticket as context.
- **Nothing documented?** – If no article matches, it says so instead of making up steps. Draft articles are marked as drafts.
- **Copy** or **Add to note** puts the answer and its article links on the clipboard or into the [Notes tab](note-backup.md) (a snapshot is saved first).

## Settings

**Settings → Plugins → Solutions Chat** has no settings of its own. It shows:

- whether [AI Features](ai-features.md) has a provider set up,
- whether [the Freshservice API](freshservice.md#the-freshservice-api) is connected,
- **Test a Solutions search**, which checks that your API key can read Solutions articles.

## Data

None of its own. It uses the AI Features and Freshservice settings.

## Limits and known issues

- Freshservice only. The API key needs permission to view Solutions articles.
- Each question makes two AI requests (one to choose search terms, one to answer).
- Answers are only as good as your articles: it can't answer from tickets or anywhere else.
- **Add to note** needs [Note Backup](note-backup.md).

## See also

- [AI Features](ai-features.md) and [AI provider setup](ai-providers.md)
- [Freshservice](freshservice.md)
