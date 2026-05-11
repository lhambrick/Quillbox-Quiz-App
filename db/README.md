# Database & Edge Functions

This project uses your own Supabase project (not Lovable Cloud).

## Schema migrations

Apply in order in your Supabase dashboard → **SQL Editor** → **New query**:

1. `db/0001_init.sql` — initial schema (M1: profiles, quizzes, questions, tiers, submissions, RLS).
2. `db/0002_m2.sql` — M2 additions (per-tier email template fields, `quiz-assets` storage bucket + policies).
3. `db/0003_m3.sql` — M3 additions (`category_description` question type, owner-can-test-submit RLS).
4. `db/0004_m4.sql` — M4 additions (`result_tiers.image_url` for results page tier image).
5. `db/0005_m5.sql` — M5 additions (RLS policy: quiz owners/editors can delete submissions).
6. `db/0006_m3_team.sql` — Team & sharing (invite read-by-token policy + `accept_quiz_invite` RPC).
7. `db/0007_email_send_rpcs.sql` — Email RPCs so quiz-result + invite emails send from the app's server route (no Edge Function deploy needed).

All files are idempotent (safe to re-run).

## Auth settings

- **Authentication → Providers → Email**: enable email/password.
- **Authentication → URL Configuration**: set Site URL to your app's URL.
- For local/preview testing, you may want to disable "Confirm email".

## Edge Function: `send-quiz-result`

Renders a branded HTML email for a quiz submission and sends it via the
tenant's own Resend API key (stored in `email_provider_configs` with RLS).

### Deploy

Install the Supabase CLI (https://supabase.com/docs/guides/cli) once, link
your project, then:

```bash
supabase functions deploy send-quiz-result --no-verify-jwt
```

`--no-verify-jwt` is required because the public quiz page (which is open
to unauthenticated prospects) is what triggers the email.

### Secrets

No global secrets are needed. The function uses the auto-injected
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to read the per-tenant
Resend key from `email_provider_configs`.

Each tenant adds their own Resend API key under **Quiz editor → Email tab**.
For testing, `onboarding@resend.dev` is allowed as the From address;
in production a verified domain is required by Resend.

### Tracked booking redirect

`/r/booking/:submission_id` logs a row in `booking_clicks` then redirects
to the quiz's configured `settings.booking_url` (Calendly, Cal.com,
HubSpot Meetings, SavvyCal, Tidycal, etc.). The CTA in the result email
also points to this tracked URL.

## 0008_email_config_collaborator_read.sql

Lets quiz **collaborators** (Editors and Viewers) read the per-quiz
`email_provider_configs` row so the **Email tab** shows the same
configuration to everyone on the project. Editors can also update the
config; only the owner can insert or delete it. Apply once in the SQL
editor — safe to re-run.

## 0009_tier_email_attachments.sql

Adds `result_tiers.email_attachments` (jsonb array of `{filename, url}`)
and updates `get_quiz_result_email_payload` so the result email server
function can attach per-tier files (e.g. a tier-specific PDF package)
to every quiz result email. Files are uploaded from the **Email tab**
into the existing `quiz-assets` bucket. Apply once in the SQL editor —
safe to re-run.
