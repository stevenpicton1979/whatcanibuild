# WhatCanIBuild — Architecture & Design Decisions

## Sprint 1 — April 2026

---

### 1. Stripe Mode: Test vs Live

**Decision:** Stripe is configured in **test mode** for Sprint 1.

**Action required before launch:**
- Replace `STRIPE_SECRET_KEY` (`sk_test_...`) with `sk_live_...`
- Replace `STRIPE_PUBLISHABLE_KEY` (`pk_test_...`) with `pk_live_...`
- Re-register the webhook endpoint in the Stripe dashboard pointing to the production URL
- Copy the new `STRIPE_WEBHOOK_SECRET` into Vercel env vars
- Remove test card instructions from any internal docs

---

### 2. Email Sending Domain

**Decision:** Emails are sent from `WhatCanIBuild <hello@clearoffer.com.au>` during Sprint 1.

**Reason:** `whatcanibuild.com.au` has not yet been added as a verified sending domain in Resend. `clearoffer.com.au` is already verified (SPF, DKIM, DMARC in place) so emails deliver reliably without hitting spam.

**Action required before launch:**
- Add `whatcanibuild.com.au` to Resend as a custom domain
- Add the DNS records Resend provides (same pattern as clearoffer.com.au)
- Once verified, change the `from` field in `api/webhook.js` to `WhatCanIBuild <hello@whatcanibuild.com.au>`

---

### 3. Stripe Webhook: Raw Body Handling

**Decision:** `api/webhook.js` reads the raw HTTP body by consuming the `req` stream directly before any parsing occurs.

**Reason:** `stripe.webhooks.constructEvent()` verifies a HMAC signature over the exact raw bytes sent by Stripe. Re-serialising a parsed JSON object (via `JSON.stringify`) alters whitespace and potentially property order, invalidating the signature. The `handler.config = { api: { bodyParser: false } }` pattern only applies to Next.js API routes — this is a standalone Vercel project, so that config has no effect. Reading the raw stream is the only reliable approach.

**Note for local development:** Use the Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhook`) for local webhook testing. The CLI provides a temporary signing secret that differs from the dashboard webhook secret — update `.env.local` accordingly.

---

### 4. ZoneIQ Data Gaps

**Known gaps found during development:**

- **Pool/outbuildings and second storey addition** appear in the landing page icon grid (marketing copy) but ZoneIQ does not return dedicated fields for these. They are covered implicitly: `max_height_m` / `max_storeys` addresses storey limits; `max_site_coverage_pct` and `setbacks` cover outbuilding placement. No separate report questions were added — 10 questions is the right number.
- **Setbacks** (`rules.setbacks.front_m`, `.side_m`, `.rear_m`) may be `null` for some zones. The report falls back to directing the user to Brisbane City Plan 2014 Table 6.1.
- **School catchments** may be absent. The fallback directs users to the Queensland Government school catchment finder.
- **`zone.council` field**: If ZoneIQ does not return this field for an out-of-coverage address, the lookup API defaults to `brisbane` and proceeds. This is acceptable for Sprint 1; a future improvement is to validate lat/lng against the Brisbane LGA boundary.
- **`short_term_accom_permitted` field**: ZoneIQ may not always return this. The report gracefully falls back to "Data not available for this zone".

---

### 5. Report Generation Edge Cases

- **ZoneIQ failure during webhook processing:** The webhook marks the Supabase record as `status='failed'`. The report page surfaces a support email. No retry logic in Sprint 1.
- **Stripe sends duplicate webhook events:** The Supabase `update` is idempotent — re-running it overwrites with identical data. Acceptable for Sprint 1; production hardening should add a processed-events ledger to prevent double emails.
- **Webhook fires before `create-checkout.js` Supabase insert completes:** Theoretically possible in a race but practically negligible — payment completion takes seconds of user interaction. The `update` query in the webhook targets `stripe_session_id`; if no matching row exists yet, Supabase silently updates 0 rows and the report is lost. Mitigation for production: use `upsert` in the webhook instead of `update`.
- **Email delivery failure:** Non-fatal. The report is still stored and accessible via the token URL. Email errors are logged but do not trigger a non-200 response to Stripe (which would cause retries).

---

### 6. Vercel Project Configuration

**Decision:** `vercel.json` sets `"framework": null`.

**Reason:** Without this, Vercel may auto-detect the `stripe`/`@supabase` dependencies and attempt a Next.js or similar framework build, which would fail on a plain HTML project. `framework: null` tells Vercel this is a static site with serverless functions — no build step required.

---

### 7. No TypeScript / No Build Step

**Decision:** Plain CommonJS JavaScript throughout all API files.

**Impact:** No compile-time type safety. ZoneIQ field names and shapes are validated at runtime with null-coalescing (`?.`, `||`) throughout `generateReport()`. If ZoneIQ changes its response shape, errors will surface at report generation time (logged in Vercel function logs).

---

### 8. Supabase Client Instantiation

**Decision:** Each API function creates a fresh Supabase client via a `getSupabase()` helper on every invocation.

**Reason:** Vercel serverless functions can be cold-started at any time. Module-level singletons survive within a warm instance but are re-created on cold start anyway. The helper pattern is consistent, readable, and avoids any risk of stale auth state across invocations.
