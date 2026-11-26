# Brief: Inquiry First Responder

Plain-English notes so you can explain each choice on a call. This is a portfolio demo with sample data, not a client product.

## The pitch in one breath

An Owner loses jobs when a call or message waits too long. This answers within seconds, collects the four things a person needs, and hands over with a short summary. It never quotes or promises a time, because those are the two things that cost an Owner money or trust if they are wrong.

## Why Chatwoot and the Agent Bot webhook

Chatwoot is a real, open source shared inbox. Its built in AI assistant (Captain) is paid. The core Agent Bot feature is free and just sends a webhook, so any small service can act as the bot. That lets me show an Owner the same result without a paid add on. Only code outside its `enterprise/` folder was read, and none of it is copied.

## Why rules first, Claude optional

- Runs with no key, no cost, nothing to sign up for.
- Predictable. An Owner can read the rules and know what it will say.
- The rules decide the flow. Claude, if switched on, can only reword routine questions. It never sees safety text, handoff text or anything about price or time, and every draft is checked and thrown away if it adds money, time promises, claims or links.
- A customer message is untrusted. Anything inside it that says "ignore your rules" has no effect on the flow, because the flow is not decided by Claude.

## Never invent prices or availability

Two layers. The engine never has price or schedule data, so there is nothing to leak. And when someone asks, the reply says it cannot answer, the question is flagged in the private note, and a person picks it up. Tests check that replies contain no money or time promises.

## Handing off

Safe default: when unsure, hand off. Triggers are a safety problem, a request for a person, a complaint, a question it cannot answer, or two confusing messages. Handoff means four things in Chatwoot: a reply to the customer, a private note, labels, and the status moves from pending to open so a person sees it. If the Chatwoot API fails mid reply, the chat is still opened so nobody waits on a broken bot.

## Safety wording

A burning smell, sparks, smoke or a shock skip the questions. The customer gets standard safety advice and the chat is marked urgent for a person. A "smoke alarm" install is deliberately not treated as an emergency.

## Security

Chatwoot signs each delivery. The service checks the signature with a constant time compare, rejects old timestamps (5 minutes), and refuses to start without a secret unless you explicitly allow unsigned requests for local tests. It answers Chatwoot quickly, ignores repeat delivery ids (Chatwoot retries on 429 and 500), and handles one conversation at a time so fast messages cannot race.

## The demo page

Same engine, bundled into static files, no server. The right panel shows what the Owner's team would see: orange dots (leaks) turn green (fixed) as details arrive, flags for things a person must handle, the private note, and the actions taken in the inbox. Fonts load from Google Fonts, everything else is local. It says "Demo with sample data" in the header and footer.

## What I would say about limits, honestly

- Not run against a live Chatwoot yet. Built from its source and API definitions, tested against a stand in.
- Rules are keyword based and English only. Odd phrasing leads to a handoff.
- State is in memory. A real deployment would add a small database.
- Before a client goes live: set the real services and areas, run a week in shadow mode, and check every handoff.

## Key terms for the call

- **Agent Bot:** Chatwoot's free hook for a bot to read and reply to chats.
- **Pending and Open:** pending means the bot has it, open means a person has it.
- **Private note:** a note only the team sees.
- **Dry run:** the service prints what it would send instead of sending it.
