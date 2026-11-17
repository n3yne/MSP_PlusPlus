# AI provider setup

[Docs home](../README.md) › [All plugins](README.md) › [AI Features](ai-features.md) › AI provider setup

Hatz AI, OpenAI and Anthropic only need an API key (see [AI Features → Setting it up](ai-features.md#setting-it-up)). The two Microsoft options need a little setup in Azure first.

## Azure OpenAI

Uses OpenAI models hosted in your own Azure OpenAI or Azure AI Foundry resource.

1. In the Azure portal (or [ai.azure.com](https://ai.azure.com)), deploy a chat model such as `gpt-4o` and note the **deployment name**.
2. From the resource's **Keys and Endpoint** page, copy the **Endpoint** (e.g. `https://your-resource.openai.azure.com/`) and a **Key**.
3. In **Settings → Plugins → AI Features**, choose **Azure OpenAI** and fill in **Endpoint**, **Deployment Name** and **API Key**.

Requests go to the Azure OpenAI v1 API (`/openai/v1/chat/completions`). The key is tied to the endpoint it was entered for: change the endpoint and you'll need to enter the key again.

## Microsoft 365 Copilot

Uses the [Microsoft 365 Copilot Chat API](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview). Each person signs in with their own work account.

> **Preview.** The Chat API is in preview (Microsoft Graph `/beta`) and may change. Copilot also draws on the user's Microsoft 365 data (mail, chats, files) when answering; MSP++ turns off web search grounding for every request.

**Requirements**

- A **Microsoft 365 Copilot** licence for each user (the add-on licence; free Copilot Chat isn't supported by the API).
- A one-time **Entra ID app registration**, set up by a tenant admin.

### Admin setup (once per tenant)

1. In the [Entra admin center](https://entra.microsoft.com), go to **App registrations → New registration**:
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: platform **Public client/native (mobile & desktop)**, value `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add all of `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All` and `ExternalItem.Read.All` (the Chat API requires every one), then click **Grant admin consent**.
3. Share the **Directory (tenant) ID** and **Application (client) ID** from the app's **Overview** page with your team.

### Per-user setup

1. In **Settings → Plugins → AI Features**, choose **Microsoft 365 Copilot**.
2. Enter the **Directory (Tenant) ID** (or your domain, e.g. `contoso.onmicrosoft.com`) and the **Application (Client) ID**.
3. Click **Sign in** and complete the Microsoft sign-in window.

The sign-in is stored encrypted (in `plugins\ai-features\m365-token.dat`, never in `settings.json`) and refreshes by itself. **Sign out** removes it. The sign-in window uses its own browser profile, separate from your tabs.

## See also

- [AI Features](ai-features.md)
- [Troubleshooting → API features](../troubleshooting.md#api-features)
