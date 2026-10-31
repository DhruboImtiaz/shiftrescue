# ShiftRescue

AI-assisted volunteer planning for when plans change. Create an event from text, a roster photo, or English/Bengali voice notes; review the draft, build the schedule, and preview later changes before saving.

**Capacity:** up to **80 volunteers**, **24 shifts**, and **1–8 people per shift**, on one day in **Asia/Dhaka**.

[Live site](https://shiftrescue.netlify.app/) · [Detailed setup and operations guide](docs/guide.md)

## What it does

- Draft event details with Google's hosted Gemma; keep manual setup available.
- Assign people one shift at a time or request a complete schedule.
- Check availability, overlaps, staffing capacity, required skills, and hour limits.
- Describe changes, review the proposed assignments, and save when ready.
- Save private events across devices, with version checks and recoverable Trash.
- Edit account details, an optional bio, and a circular profile photo.

## Run locally

Requires **Node.js 22+**, a Supabase project, and a Google AI Studio key for AI features.

```sh
npm ci
cp .env.example .env
npm start
```

Fill in `.env` with:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public/publishable client key |
| `GEMINI_API_KEY` | Private Google AI Studio key |
| `GEMMA_MODEL` | Default: `gemma-4-26b-a4b-it` |
| `PROPOSAL_SECRET` | Stable random secret, at least 32 characters |
| `COOKIE_SECURE` | `false` locally; HTTPS/Netlify uses secure cookies |

Open [localhost:5173](http://127.0.0.1:5173), then sign in or create an account. The existing workspace is at `/workspace.html`; it can run without cloud configuration during local development. Never commit `.env` or expose privileged Supabase keys.

## Database and deployment

- **New database:** run [supabase/schema.sql](supabase/schema.sql).
- **Existing database:** apply pending files in [supabase/migrations](supabase/migrations) in order; don't rerun the full schema. The capacity migration expands limits without deleting saved events.
- **Netlify:** connect the repository. [netlify.toml](netlify.toml) configures the build, static assets, and API function. Set the environment variables above in the Functions scope, keep `PROPOSAL_SECRET` stable, and configure Supabase Auth's Site URL for your deployed domain.

See the [guide](docs/guide.md) for migration, email-confirmation, profile-storage, deployment, and troubleshooting details.

## Checks

```sh
npm test
npm run check
npm run build
```

The deterministic scheduler uses a bounded search and validates every proposed schedule. Large or tightly constrained events may reach the search limit; that does **not** prove no valid plan exists. You can keep working with partial/manual assignments. AI imports also depend on provider response limits and quota.

Built with browser JavaScript, Node/Netlify Functions, Supabase Auth/Postgres/Storage, and Google's Gemini API for hosted Gemma and speech transcription. [MIT license](LICENSE).
