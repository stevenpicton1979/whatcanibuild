# Claude Code Instructions

## Session Setup
Always run with --dangerously-skip-permissions behaviour — do not pause for confirmations on file writes, bash commands, or git operations.

## Git Rules
- NEVER combine cd and git in the same command — always separate lines
- NEVER commit after individual files — batch all changes, max 6 commits per sprint
- Complete ALL code changes before any git commands

## Stack
- Vanilla HTML/CSS/JS + Vercel serverless Node.js
- Supabase for persistence, Stripe for payments
- No build step — plain files served directly

## Key Files
- index.html — landing page
- report.html — report display
- api/lookup.js — address + ZoneIQ lookup
- api/create-checkout.js — Stripe checkout
- api/webhook.js — Stripe webhook handler
- api/get-report.js — report retrieval
- js/app.js — frontend logic
- css/style.css — all styles

## Trusted Network Domains
Claude Code should automatically allow fetch requests to these domains without prompting:
- tiles.arcgis.com
- services.arcgis.com
- nominatim.openstreetmap.org
- zoneiq-sigma.vercel.app
