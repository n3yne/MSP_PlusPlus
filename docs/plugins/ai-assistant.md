# AI Assistant

[Docs home](../README.md) › [All plugins](README.md) › AI Assistant

**Category:** AI · **Side panel tab:** 🤖 Assistant · **Needs:** MSP++ 0.8.7 or later, [AI Features](ai-features.md) 0.8.8.1+ and [Freshservice](freshservice.md) 0.8.8.3+ with [its API](freshservice.md#the-freshservice-api) (installed together)

A general AI chat in the side panel that can look things up in Freshservice to answer your questions. It reads tickets, requesters, agents, groups, assets, problems, changes and Solutions articles through the Freshservice API. It can't change anything.

## Using it

- **Ask** – Type a question, for example "What else has this requester logged this month?", "Which laptop does jane@example.com use?", "Summarise ticket #4521" or "How many urgent tickets does the Network group have open?".
- **Use the open ticket** – When ticked and a Freshservice ticket is open in the active tab, "this ticket" and "this requester" mean that ticket and its requester.
- **Looked up** – Under every answer is a list of what was looked up, which is also exactly what was sent to the AI with your question. Items with a link open in a new tab; failed lookups are marked.
- **Ticket links** – Ticket numbers in an answer (#1234) open the ticket in a new tab.
- **Copy** or **Add to note** puts the answer on the clipboard or into the [Notes tab](note-backup.md) (a snapshot is saved first).
- **New chat** forgets the conversation. Within a chat, the last few questions and answers go with each new question.

### How it finds data

Which way it works depends on the provider chosen in [AI Features](ai-features.md):

| Provider | How lookups are chosen |
|---|---|
| Azure OpenAI, OpenAI, Anthropic | **The AI decides.** It asks for lookups (tool calling), the assistant runs them and sends back the results, and the AI answers. Up to 8 lookups per question. |
| Copilot website, Microsoft 365 Copilot, Hatz AI | **The AI asks, MSP++ fetches.** The assistant first reads the open ticket, any ticket numbers (#1234, "ticket 1234", INC-1234) and email addresses in your question, and your open tickets when you ask about "my tickets", "my queue" or what to work on next (for an email, also that requester's tickets from the last 90 days, and their assets when you ask about a laptop, device or asset). It sends that with the list of lookups it can run. The AI either answers, or replies with a lookup request (a `LOOKUP [...]` line), which MSP++ runs and sends back with the question. On the Copilot website that's up to 2 extra rounds; with the others, up to 3. |

All lookups for one question, in either mode, count toward the limit of 8.

**On the Copilot website, each round is a new Copilot chat.** The request is pasted into Copilot's message box so its line breaks don't send it early. You press **Send** in the Copilot window and then use its reply, once per round, so a question that needs more data takes two or three Sends. With **Send Automatically** turned on in AI Features, the rounds run by themselves. The status line in the Assistant tab says when Copilot is waiting for you.

### What it can look up

| Lookup | What it reads |
|---|---|
| Ticket | Subject, status, priority, requester, agent, group, dates, tags, description, replies and notes |
| Your open tickets | The open tickets assigned to you (the agent your API key belongs to), with priority, status, due dates and escalation |
| Ticket filter | Up to 30 tickets matching a Freshservice filter (status, priority, requester, agent, group, department, type, tag, dates), with the total count |
| Requester | Find by email or name, or read by id: name, email, job title, phones, department and location |
| Agent | Find by email or name |
| Groups | All agent groups and their ids |
| Assets | Find by name, asset tag or serial number, or the assets a person uses; read one with its type fields |
| Problem, change | One record by number, with planned dates for changes |
| Solutions | Search articles and read the start of each |

## Settings

**Settings → Plugins → AI Assistant** has no settings of its own. It shows:

- whether [AI Features](ai-features.md) has a provider set up, and which of the two ways above it will use,
- whether [the Freshservice API](freshservice.md#the-freshservice-api) is connected,
- **Test a ticket lookup**, which reads a ticket the way the assistant does.

## Data

None of its own. It uses the AI Features and Freshservice settings, and keeps the conversation in memory only (it's gone when you click New chat or restart).

## Limits and known issues

- **Read-only.** Every lookup is an API read (GET) to your configured Freshservice domain. It can't add notes, change status or assign tickets. Ask it how, and it tells you.
- **What you look up goes to the AI.** Ticket text, names, emails and asset details that the assistant looks up are sent to your AI provider with the question. Each answer lists them.
- Everything is read as the agent your API key belongs to. Lookups that agent can't see fail (403) and are shown as failed.
- Results are trimmed (about 6,000 characters each, 8,000 for a ticket) and lists are capped (30 tickets, 10 assets, 5 people, 5 articles), so very long tickets or big lists are cut short.
- When the AI asks for more data, each question takes several AI requests (one per round of lookups), which count toward your provider's usage. On the Copilot website that means one Send per round.
- An AI without tool calling sometimes answers without asking for the data it needs, or asks in a format MSP++ can't read. Then you get its answer as it is. Rephrasing ("look up …") usually helps.
- Freshservice only for now. Another site plugin can take part by answering the same `assistant-tools` and `assistant-lookup` handlers.
- Not yet tested against a live Freshservice account or a live Azure OpenAI deployment.

## See also

- [AI Features](ai-features.md) and [AI provider setup](ai-providers.md)
- [Freshservice](freshservice.md)
- [Solutions Chat](solutions-chat.md), for answers that come only from your Solutions articles, with citations
