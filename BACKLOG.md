# WhatCanIBuild Backlog

## How this works
Claude Code reads this file at the start of every session and works through tasks marked [ ] from top to bottom. Mark [x] when done. Edit via GitHub.com on your phone.

## Ready to build next
- [ ] Add bushfire overlay question to report — once ZoneIQ Sprint 8 live, add "Is this property in a bushfire prone area?" as question 11. Update webhook.js generateReport() and locked preview grid in index.html.
- [ ] Add heritage overlay question — once ZoneIQ Sprint 9 live, add "Is this property heritage listed?" as question 12.
- [ ] Add aircraft noise question — once ZoneIQ Sprint 10 live, add "Is this property in an aircraft noise zone?"
- [ ] Sample report page — create /sample-report.html showing pre-generated report for 6 Glenheaton Court Carindale. No payment. Link from landing page. Drives SEO and trust.
- [ ] Bundle pricing — add 3-report bundle at $49.99. Second Stripe product, second checkout option on preview card.
- [ ] Move email sending to hello@whatcanibuild.com.au once Resend allows second domain.
- [ ] Update ZoneIQ API URL in report.html footer from zoneiq-sigma.vercel.app to zoneiq.com.au.

## Ideas to validate
- [ ] Gold Coast specific landing page — separate SEO page
- [ ] Sunshine Coast specific landing page
- [ ] Granny flat calculator — free tool that upsells to full report

## Done
- [x] Full payment + report flow
- [x] Landing page redesign — new headline, trust bar, why section, sample report cards
- [x] Price $9.99 → $19.99
- [x] Gold Coast + Moreton Bay + Sunshine Coast unlocked
- [x] Stripe live mode
- [x] whatcanibuild.com.au custom domain
- [x] Richer plain-English answers with links and cost guidance
- [x] Improved error messages (ZONE_NOT_SEEDED, OUTSIDE_COVERAGE)
- [x] Staging branch for test mode
- [x] BACKLOG.md created
