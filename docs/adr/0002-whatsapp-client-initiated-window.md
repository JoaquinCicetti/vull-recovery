# ADR 0002 — WhatsApp via client-initiated `wa.me` + 24h free window

- **Status:** Accepted
- **Date:** 2026-05-28

## Context
We need to communicate with clients on WhatsApp (confirmations, coordination) at
~zero cost. Meta's 2025+ pricing is per-message: business-initiated *template*
messages are billed (Argentina: utility/auth ≈ US$0.026, marketing ≈ US$0.062),
but when **the customer messages first, replies are free for 24 hours**. Meta
charges no monthly fee.

## Decision
In v1 the client always initiates the conversation via a pre-filled `wa.me` deep
link. All our replies then ride the free 24h window. We never send a
business-initiated paid template. An optional Cloud API webhook
(`whatsapp-webhook`) logs inbound messages and tracks the window.

## Consequences
- WhatsApp cost in v1 is effectively zero.
- Minor UX friction: the client must tap the link to open the chat.
- No Meta business verification or template approval needed for v1.
- Proactive reminders (which would need a paid utility template or email) are
  deferred — see ADR 0001.

## Alternatives considered
- Full Cloud API + interactive **Flows** (book inside the chat) — powerful but
  needs Meta verification, template approval, and more build; deferred.
- Unofficial libraries (Evolution API) — violate WhatsApp ToS, risk number bans;
  rejected.
