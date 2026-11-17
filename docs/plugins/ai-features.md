# AI Features

[Docs home](../README.md) › [All plugins](README.md) › AI Features

**Category:** AI · **Needs:** an AI provider account, and [Note Backup](note-backup.md) for its buttons · **Used by:** [Solutions Chat](solutions-chat.md)

Adds **✨ Suggest** and **📋 Summarize** to the [Notes tab](note-backup.md). Works with Hatz AI, OpenAI, Anthropic, Azure OpenAI and Microsoft 365 Copilot.

## Using it

- **✨ Suggest** – Sends your current note to the AI and shows an improved version in a review box. Nothing changes until you **Apply**. To adjust it, type an instruction in **Refine** ("make it shorter", "write it for the client") and click **↺ Refine**.
- **📋 Summarize** – Reads the ticket's description, replies and notes and asks the AI for a short bullet-point summary. **Insert** adds it to your note (a snapshot is saved first).

Where the ticket text comes from:

- [Freshservice](freshservice.md): through [the API](freshservice.md#the-freshservice-api) when it's set up, otherwise from the page.
- [ConnectWise Manage](connectwise-manage.md): the ticket's notes, from the page.
- Any other page: the page's visible text.

## Setting it up

1. Open **Settings → Plugins → AI Features**.
2. Choose a **Provider** and fill in what it asks for:
   - **Hatz AI** – an API key from the [Hatz Admin Dashboard](https://ai.hatz.ai).
   - **OpenAI** – a key from [platform.openai.com](https://platform.openai.com/api-keys).
   - **Anthropic** – a key from [console.anthropic.com](https://console.anthropic.com/settings/keys).
   - **Azure OpenAI** or **Microsoft 365 Copilot** – see [AI provider setup](ai-providers.md); both need some setup in Azure.
3. For Hatz, OpenAI and Anthropic, pick a **Model**. The list fills in once a valid key is saved.

## Settings

| Setting | What it does | Default |
|---|---|---|
| Provider | Which AI service to use. | Hatz AI |
| API Key | The provider's key (stored encrypted). | empty |
| Model | The model to use (Hatz, OpenAI, Anthropic). | – |
| Endpoint, Deployment Name | Azure OpenAI only. See [AI provider setup](ai-providers.md#azure-openai). | empty |
| Directory (Tenant) ID, Application (Client) ID, Sign in | Microsoft 365 Copilot only. See [AI provider setup](ai-providers.md#microsoft-365-copilot). | empty |

## Data

Settings and the encrypted API key are in `settings.json`. A Microsoft 365 sign-in is kept encrypted in `plugins\ai-features\m365-token.dat` and deleted when you sign out. See [Files and folders](../data-files.md#plugin-data-datapluginsplugin-id).

## Privacy

Suggest sends your note to the provider. Summarize sends the ticket's text, which can include the requester's name, email and anything in the conversation. Use a provider your organisation has approved.

## Limits and known issues

- The buttons live in the Notes tab, so [Note Backup](note-backup.md) has to be installed and turned on.
- A saved key only works with the provider (or Azure endpoint) it was entered for. Switching provider means entering that provider's key; the old key is never sent to the new one.
- Each click is one request to your provider and counts toward its usage and cost.

## See also

- [AI provider setup](ai-providers.md) for Azure OpenAI and Microsoft 365 Copilot
- [Solutions Chat](solutions-chat.md), which uses the provider set up here
