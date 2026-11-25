# Ticket Notifications

[Docs home](../README.md) › [All plugins](README.md) › Ticket Notifications

**Stage:** [Beta](../plugin-release-stages.md) · **Category:** Tickets · **Needs:** the [Freshservice](freshservice.md) plugin with [its API](freshservice.md#the-freshservice-api) set up

A desktop notification when a Freshservice ticket assigned to you gets a new reply.

## Setting it up

1. Set up [the Freshservice API](freshservice.md#the-freshservice-api).
2. In **Settings → Plugins → Ticket Notifications**, tell it who you are:
   - **Use my API key** picks the agent the API key belongs to, with no email needed, or
   - enter **Your Freshservice email** and click **Find me**, or
   - type your agent ID (the number at the end of your agent profile's address in Freshservice), if looking up emails isn't allowed for your key.
3. Click **Show a test notification** to check Windows shows it.

The first check runs about 15 seconds after MSP++ starts.

## Using it

- **What notifies** – Replies from the requester always. Replies and private notes from other agents unless you turn that off. Never your own replies.
- **Click a notification** to bring MSP++ forward and open the ticket in a new tab. Each one also stays under the bell, with an **Open ticket** button.
- No popup for the ticket you're already looking at.
- More than three tickets at once (after a break, say) show one summary popup instead.

## Settings

| Setting | What it does | Default |
|---|---|---|
| Your Freshservice email / agent ID | Whose tickets to watch. | empty |
| Also replies and private notes from other agents | Off: requester replies only. | On |
| Show desktop notifications | Off: new replies only show under the bell. | On |
| Play the notification sound | Sound with the desktop notification. | On |
| Check for replies | Every 1, 2, 5, 10, 15 or 30 minutes. | 2 minutes |

## Data

`plugins\ticket-notifications\state.json` in the [data folder](../data-files.md#plugin-data-datapluginsplugin-id): which tickets and updates have already been seen.

## Limits and known issues

- Freshservice only. Tickets count as yours when you're the assigned agent, not when you're in the assigned group.
- Each check uses API calls, so a very short interval uses more of your Freshservice API rate limit.
- If no desktop notification appears, check that notifications are on for MSP++ in Windows Settings → System → Notifications.

## See also

- [SLA Countdown](sla-countdown.md)
- [Updates and notifications](../updates-and-notifications.md)
