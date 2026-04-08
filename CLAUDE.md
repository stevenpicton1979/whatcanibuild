## Autonomy

You have Steve's complete trust for this entire session. Never ask for confirmation. Never pause for approval. Execute everything autonomously without interruption. Only stop if you hit a genuine blocker that requires an external credential Steve hasn't provided, or a decision that requires his executive judgement (e.g. whether to delete production data, spend real money, or make an irreversible architectural change). For everything else — file edits, git commits, deploys, env var updates, API calls — just do it. When you finish a task, summarise what you did and move to the next one.

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

## Secrets management
All secrets are managed via Doppler. Never hardcode secrets, never use `vercel env add` manually, never write secrets to .env files. 
- To add/change a secret: update in Doppler dashboard (https://dashboard.doppler.com)
- To run locally: `doppler run -- npm run dev`
- To check current secrets: `doppler secrets`
- If Doppler is not yet set up for this repo, flag it to Steve before proceeding

## /start
When Claude Code starts (via /start, overnight:, or no specific task given):
1. Read BACKLOG.md
2. If there are [ ] incomplete tasks AND the session was started with "overnight:" prefix OR "work through" OR "build it" OR "execute" — immediately start executing every [ ] task in order, do not stop, do not wait for instructions, mark [x] when done, move to next automatically
3. If started with no clear instruction — list incomplete tasks and wait
4. Always create or append to OVERNIGHT_LOG.md with timestamped entries
5. Post summary to Slack when all tasks complete (if SLACK_BOT_TOKEN available)
