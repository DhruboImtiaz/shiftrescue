# ShiftRescue

**A change of plans, handled.**

ShiftRescue helps volunteer coordinators recover when someone calls in sick, loses availability or needs fewer hours. Describe the change in plain language, review Gemma’s interpretation, and preview a repaired schedule before accepting it.

It also supports real event setup: create an event, add volunteers and their skills, define shifts, and generate a valid first schedule. Email/password accounts and private saved events use Supabase. The full stack deploys to **Netlify**, including the backend.

## Why this exists

A last-minute absence can trigger several replacements. A spreadsheet can show a gap, but finding cover still requires checking skills, availability, overlapping shifts and total hours. ShiftRescue checks those rules together and tries to preserve as much of the existing rota as possible.

## Features

- **Your own events:** names, dates, volunteers, multiple availability windows, custom skills, hour limits and shifts.
- **Gemma interpretation:** translates natural-language changes into structured constraints, with clarification for ambiguity.
- **Verified scheduling:** checks staffing, skill coverage, full-shift availability, overlaps and maximum hours.
- **Review before apply:** interpretation, repair preview and final acceptance are separate steps.
- **Private cloud storage:** Supabase Auth, row-level ownership policies, atomic saves and stale-version protection.
- **Quota fallback:** the Gemma panel displays a retry/refresh time when available. Manual team editing and schedule generation continue without an AI call.
- **Activity and export:** saved change history and CSV export.
- **Netlify backend:** server functions, HTTPS cookies and signed previews that survive independent function invocations.

## Run locally

Requires **Node.js 22 or newer**.

```bash
npm ci
cp .env.example .env
# Fill in your private settings in .env.
npm start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The local server generates a private `PROPOSAL_SECRET` automatically if it is missing. Keep `.env` private; it is excluded from Git.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key, used only on the server |
| `GEMMA_MODEL` | Hosted Gemma model ID; default `gemma-4-26b-a4b-it` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Project publishable key; no service-role key is required |
| `PROPOSAL_SECRET` | Independent random secret, at least 32 characters, signing repair previews |
| `PORT` | Local port, default `5173` |
| `COOKIE_SECURE` | `false` for local HTTP; HTTPS deployments use secure cookies |

The service is called the Gemini API, but the app explicitly selects a **Gemma** model. Obtain a key in [Google AI Studio](https://aistudio.google.com/apikey) and check that the chosen model is available to your project. See Google’s [hosted Gemma guide](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api).

Without Supabase, the local fictional workspace and solver remain usable. Without a Gemma key, manual settings and the scripted scenarios still work. Public Netlify use of the model requires a signed-in Supabase account.

## Set up Supabase

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL editor. It creates five tables, ownership policies and two transactional functions.
3. Enable **email/password** authentication. The app does not offer guest sign-in.
4. Put the project URL and publishable key in your local environment or Netlify environment settings.
5. In Supabase **Authentication → URL Configuration**, set your deployed site as the Site URL and add the local and deployed origins to the allowed redirect URLs as needed.

For the earlier ShiftRescue schema, use [`supabase/upgrade-drafts.sql`](supabase/upgrade-drafts.sql) once instead of re-running the initial schema. The connected ShiftRescue project has already received this upgrade.

Create an account through the app, confirm the email if required, then return and sign in. Supabase dashboard sign-in is separate from app sign-in. Auth settings such as email delivery, signup limits and compromised-password protection are managed in Supabase; production use should configure those settings for its audience.

## Deploy to Netlify

Full instructions: **[NETLIFY.md](NETLIFY.md)**.

1. Import this GitHub repository into Netlify.
2. Use build command **`npm run build`**, publish directory **`dist`**, and functions directory **`netlify/functions`**. These are already specified in `netlify.toml`.
3. Add the server environment variables above. Generate a strong `PROPOSAL_SECRET`; do not use the example placeholder.
4. Deploy, then update Supabase’s Site URL/redirect settings with the real HTTPS site address.
5. Verify sign-in, event creation, schedule generation, Gemma interpretation and applying a repair on the deployed site.

Deploy the repository with its function code. Uploading only the static `dist` folder omits the backend. Netlify builds the `/api/*` function separately, and secrets belong in Netlify’s server environment settings, never in browser files.

## Use your own event

1. **Sign in**, then choose **New event**. Leave the copy option unchecked for an empty event.
2. Open **Manage team & shifts**. Add volunteers with skills, availability and maximum daily hours.
3. Add shifts with their staffing requirements and required skills. For each required skill, at least one person assigned to that shift must have it.
4. Click **Generate schedule**, inspect the preview and **Apply repair**.
5. When someone’s plans change, describe the update in the Gemma box. Review the interpretation, confirm it, review the repair and apply it.
6. Use **Refresh** to load a newer cloud version, **Activity** to inspect changes, and **Export** for a CSV.

Setup edits save immediately. If they break coverage, assignments are cleared into an explicit **draft**; generate a new valid schedule before using the rota. Unconfirmed repairs do not change the accepted event. A stale preview or a preview older than ten minutes must be regenerated.

The local demo contains fictional volunteers and six shifts on 18 October 2026. Opening a scripted scenario switches to that local workspace and leaves your cloud events intact. Scripted scenarios use predefined constraints and do **not** call Gemma.

### Example requests

```text
Nadia cannot work from 14:00 to 16:00.
Nadia can work a maximum of 2 hours today.
Nadia, Sumi and Farhana are unavailable from 14:00 to 16:00.
All first-aid volunteers are unavailable from 14:00 to 16:00.
```

Use names from your current event and exact 24-hour times. Requests are limited to **3,000 characters** and **24 changes**. “Nadia cannot work after 2” should produce a clarification instead of guessing 02:00 or 14:00. Changes to other event dates or unsupported operations also require clarification.

## Gemma quota behavior

On a Google `429` response, the Gemma box displays the limit message and preserves your request and accepted schedule.

- If Google supplies `Retry-After` or `google.rpc.RetryInfo`, the app displays the retry timestamp in **Dhaka time** and a countdown.
- If the response identifies a daily quota, it displays the expected next **midnight Pacific** refresh, converted using the correct daylight-saving offset.
- If no reset time is supplied, the box explicitly says the refresh time is unknown. A quota of zero is treated as a model-access/quota configuration issue rather than a promise that waiting will fix it.
- The app does not repeatedly call the model in the background or make automatic connection-test calls on every page load.

A retry time is an earliest retry/expected quota window, not a guarantee of capacity. Quota is shared across Google projects, so the app cannot infer a reliable “requests remaining” number. Check [AI Studio’s rate limits](https://aistudio.google.com/rate-limit) for account-specific usage. Google documents the daily request reset in its [rate-limit guide](https://ai.google.dev/gemini-api/docs/rate-limits).

## How it works

```text
Browser → same-origin Node/Netlify API → Gemma interpretation
                                  ↘ deterministic scheduling search
                                  ↘ Supabase Auth + owner-isolated PostgreSQL
```

**Gemma interprets; the solver schedules.** The model returns structured unavailability or maximum-hour changes. The server rejects invalid JSON, unknown people, unsupported operations and invalid values before they reach the solver.

The solver enumerates eligible teams for each shift, then searches with pruning. Its first objective minimizes removed person–shift assignments relative to the current rota. For a fully staffed rota with unchanged staffing, those removals correspond to replacements. Its second objective minimizes the sum of squared working minutes to balance workloads among equally small repairs. Every returned solution receives a separate rule check.

The search is bounded by time and node count. It distinguishes a proven optimum, a valid solution without proved optimality, proved infeasibility, and a search limit without a solution. It never calls a timeout proof of impossibility.

## Data and security

- All five application tables have row-level security and account ownership policies. Queries use the verified user’s token and a publishable key.
- Database functions run as the caller (`SECURITY INVOKER`); no service-role credential is used.
- Events, people, shifts, assignments and activity save atomically. Version checks prevent stale tabs from overwriting new work.
- Auth tokens use HttpOnly, SameSite cookies. Deployed cookies are Secure. Passwords and tokens are not placed in browser local storage.
- Cloud previews are HMAC-signed, bound to an owner/event/version and expire after ten minutes. Replays fail once the event version advances.
- Requests are same-origin, size-limited, and use a restrictive content security policy. The Netlify API has a per-IP request limit.
- The local demo uses browser storage. The selected cloud event ID and a tab’s unsent message/quota notice may also be stored in browser preferences. API keys stay on the server.

Volunteer names, skills, availability and your request are sent to Google when you choose to use Gemma. Do not enter sensitive personal details that scheduling does not require.

## Development and checks

```bash
npm test
npm run check
npm run build
```

Tests cover scheduling constraints, search budgets, fairness, malformed model output, auth verification, cookies, version conflicts, draft setup, quota resets including daylight-saving boundaries, cross-origin rejection, signed preview tampering/expiry and the Netlify request adapter. GitHub Actions runs these checks on pushes and pull requests. Unit tests use explicit model fixtures and do not consume live Gemma quota.

```text
public/                 Responsive browser interface
src/api.mjs             Shared Web Request/Response API
src/scheduler.mjs       Pure validation and scheduling search
src/gemma.mjs           Hosted Gemma interpretation
src/quota.mjs           Provider retry metadata and daily refresh calculation
src/cloud.mjs           Supabase Auth and versioned persistence
src/proposals.mjs       Stateless signed repair previews
src/demo.mjs            Fictional starter workspace and scenarios
server.mjs              Local HTTP server and private environment loading
netlify/functions/      Deployed backend entry point
scripts/                Build and syntax checks
supabase/               Initial schema and existing-install upgrade
test/                  Automated tests
```

## Prototype limits

An event supports **12 volunteers, 8 shifts, 1–3 people per shift**, and a single day in **Asia/Dhaka**. The model handles availability reductions and maximum-hour changes; use setup forms to add people, change skills or define shifts. Overnight shifts, recurring events, invitations, SMS/email dispatch, negotiated swaps and shared multi-coordinator workspaces are outside this version. Each account owns its own events.

This repository is ready for a Netlify deployment; a production URL and its final hosted checks depend on your Netlify environment configuration.

## License

MIT — see [LICENSE](LICENSE). Built with Node.js, browser web standards, Supabase and Google’s hosted Gemma. No model weights are redistributed.
