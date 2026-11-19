# AI provider setup

[Docs home](../README.md) › [All plugins](README.md) › [AI Features](ai-features.md) › AI provider setup

Hatz AI, OpenAI and Anthropic only need an API key (see [AI Features → Setting it up](ai-features.md#setting-it-up)). Azure OpenAI and the Microsoft 365 Copilot API need a little setup in Azure first. The [Copilot website](#copilot-website) option needs no setup at all.

## Copilot website

Uses the Copilot website, signed in inside MSP++, instead of an API. There's no app registration, admin consent or API key, and it works without a paid licence: free [Microsoft Copilot Chat](https://learn.microsoft.com/copilot/plan/copilot-overview) comes with a Microsoft work account. Use this one if you're waiting on IT for the Microsoft 365 Copilot API, or don't have its licence.

**Setting it up**

1. In **Settings → Plugins → AI Features**, choose **Copilot website (no setup)**.
2. Pick the **Chat site**: **Microsoft Copilot (work account)** (`m365.cloud.microsoft/chat`, the default), **Microsoft Copilot (copilot.microsoft.com)**, or **Other chat site** with its address.
3. Click **Open and sign in** and sign in in the Copilot window. MSP++ keeps the sign-in in its own browser profile, separate from your tabs.
4. Click **Test**. A test request appears in the Copilot window; press **Send**, then **Use this reply**. The status should say "Working".

**How a request works**

Each AI request (Suggest, Summarize, a Solutions Chat question) opens a new chat in the Copilot window with the request already typed in. Check it, press **Send** in Copilot, and click **Use this reply** in the bar at the top once Copilot has finished. The reply goes back to whatever asked for it, and the window hides. **Cancel**, or closing the window, stops the request.

If MSP++ can't find Copilot's message box (it hasn't loaded, you're signed out, or Microsoft has changed the page), the bar turns amber and the request is on your clipboard: click the message box, paste (Ctrl+V) and press Send. If **Use this reply** can't find the reply on the page, select the reply text (or click Copilot's own Copy button) and click it again.

**Send Automatically (experimental)**

Off by default. When on, the Copilot window stays hidden: MSP++ types the request, presses Send and reads the reply once it stops changing, so it behaves like the API providers. If it can't send or read the reply, the window opens so you can finish by hand.

Things to know before turning it on:

- Microsoft's terms for its AI services don't allow automated access or data extraction. With the switch off, you send every request yourself.
- It depends on how Copilot's page is built today. A Microsoft redesign can stop it working until MSP++ is updated (requests then fall back to the window).

**Limits**

- Prompts are capped at what the site's message box accepts: 16,000 characters for Copilot with a work account, 10,000 for copilot.microsoft.com, 30,000 for other sites. Summarize and Suggest leave out ticket context to fit, and Solutions Chat shortens articles.
- Your company's sign-in rules may block signing in inside MSP++, for example if Conditional Access requires a managed device or Edge. If so, use Copilot in Edge and copy and paste.
- Requests go to Microsoft like anything you type into Copilot, are covered by your organisation's [enterprise data protection](https://learn.microsoft.com/copilot/plan/enterprise-data-protection), and show in your Copilot history. Free Copilot Chat answers from the request and the web, not your mailbox or files.
- **Sign out** clears the Copilot window's sign-in and cookies.

## Azure OpenAI

Uses OpenAI models hosted in your own Azure OpenAI or Azure AI Foundry resource.

1. In the Azure portal (or [ai.azure.com](https://ai.azure.com)), deploy a chat model such as `gpt-4o` and note the **deployment name**.
2. From the resource's **Keys and Endpoint** page, copy the **Endpoint** (e.g. `https://your-resource.openai.azure.com/`) and a **Key**.
3. In **Settings → Plugins → AI Features**, choose **Azure OpenAI** and fill in **Endpoint**, **Deployment Name** and **API Key**.

Requests go to the Azure OpenAI v1 API (`/openai/v1/chat/completions`). The key is tied to the endpoint it was entered for: change the endpoint and you'll need to enter the key again.

## Microsoft 365 Copilot

Shown as **Microsoft 365 Copilot (API)** in Settings. Uses the [Microsoft 365 Copilot Chat API](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview). Each person signs in with their own work account.

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
