# AI Assistant

[Docs home](../README.md) › [All plugins](README.md) › AI Assistant

**Category:** AI · **Side panel tab:** 🤖 Assistant · **Needs:** MSP++ 0.8.7 or later, [AI Features](ai-features.md) 0.8.8+ and [Freshservice](freshservice.md) 0.8.8.2+ with [its API](freshservice.md#the-freshservice-api) (installed together)

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
| Copilot website, Microsoft 365 Copilot, Hatz AI | **Gathered first.** These can't ask for lookups, so the assistant reads the open ticket and any ticket numbers (#1234, "ticket 1234", INC-1234) and email addresses in your question. For an email address it also gets that requester's tickets from the last 90 days, and their assets when you ask about a laptop, device or asset. Then it asks once (one Send in the Copilot window). |

In the gather-first mode, questions that don't mention a ticket or an email ("how many urgent tickets are open?") can't be answered. The assistant says what it would need instead.

### What it can look up

| Lookup | What it reads |
|---|---|
| Ticket | Subject, status, priority, requester, agent, group, dates, tags, description, replies and notes |
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
- With the AI deciding, each question takes several AI requests (one per round of lookups), which count toward your provider's usage.
- Freshservice only for now. Another site plugin can take part by answering the same `assistant-tools` and `assistant-lookup` handlers.
- Not yet tested against a live Freshservice account or a live Azure OpenAI deployment.

## See also

- [AI Features](ai-features.md) and [AI provider setup](ai-providers.md)
- [Freshservice](freshservice.md)
- [Solutions Chat](solutions-chat.md), for answers that come only from your Solutions articles, with citations
