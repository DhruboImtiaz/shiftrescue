# ShiftRescue — Volunteer Schedule Rescue

> **A change of plans, handled.**

ShiftRescue helps volunteer coordinators set up events and handle last-minute absences. Describe an event to build a reviewed team and shift draft, or describe what changed to repair an existing rota. Preview and accept a schedule that satisfies staffing, skills, availability and hour limits.

Accounts start with an empty workspace. Create your own events, volunteers and shifts, or explicitly open an event you have saved. Supabase provides email/password accounts and private cloud storage; Netlify hosts the frontend and backend.

**Live:** [shiftrescue.netlify.app](https://shiftrescue.netlify.app/)

---

## Features

### Event & Team Management

- Start with zero volunteers and shifts, then create separate events with a name and date or copy a roster you have opened.
- Add, edit and remove volunteers with custom skills, multiple availability windows and maximum daily hours.
- Define shifts with staffing requirements and required skill coverage.
- Save incomplete setups as explicit drafts, then generate a valid first schedule.

### Gemma-Powered Requests

- Create a new event from a description of its name, date, volunteers, skills, availability, hour limits and shift requirements.
- Review and edit every extracted field, add or remove draft rows, and resolve missing details before saving a separate event to Supabase.
- Generate assignments with the constraint engine after setup, then review and apply the schedule separately. Infeasible events remain editable drafts.
- Interpret requests such as **“Nadia cannot work from 14:00 to 16:00.”**
- Support multiple unavailable intervals and maximum-hour changes in one message.
- Ask for clarification instead of guessing ambiguous times or unknown people.
- Validate structured model output before it reaches the scheduling engine.
- Review the interpretation and resulting repair separately before applying changes.

### Constraint-Based Scheduling

- Check full-shift availability, staffing, required skills, overlapping assignments and total hours.
- Minimize replacements in the existing rota, then use workload balance to break ties.
- Independently validate every returned schedule.
- Distinguish proved infeasibility from a search limit, and a proved optimum from a valid best-so-far result.

### Quota Fallback

- Show Gemma quota errors inside the Gemma panel while preserving the request and accepted schedule.
- Display Google’s retry time or the expected daily quota refresh in **Dhaka time**, when known.
- Clearly label unknown refresh times and zero-quota/model-access problems.
- Keep manual team editing and schedule generation available without an AI call.
- Avoid automatic model requests on every page load.
- Retry temporary Gemma service/network failures up to three attempts within one 45-second deadline. Quota and credential errors are returned immediately.
- Share quota warnings and retry timing between event setup and change requests; keep the event description when a request fails.

### Cloud Storage & Export

- Email/password accounts with private events stored in Supabase.
- Atomic saves and version checks to prevent stale tabs overwriting newer work.
- Saved activity history and CSV export.
- Short-lived signed repair previews that work across independent Netlify function calls.

---

## Tech Stack

| Concern | Solution |
| --- | --- |
| Interface | HTML, CSS and vanilla JavaScript modules |
| Server | Node.js 22+ with Web Request/Response handlers |
| AI | Google’s hosted Gemma through the Gemini API |
| Scheduling | Deterministic bounded search with pruning |
| Backend & Auth | [Supabase](https://supabase.com/) — PostgreSQL and Auth |
| Testing | Node.js built-in test runner |
| Deployment | [Netlify](https://www.netlify.com/) — static assets and server functions |
| Continuous Integration | GitHub Actions |

---

## Getting Started

### Prerequisites

- **Node.js 22 or newer** and npm.
- A [Google AI Studio](https://aistudio.google.com/apikey) key with access to a hosted Gemma model.
- A Supabase project for accounts and cloud storage.

For a new Supabase project, apply [`supabase/schema.sql`](supabase/schema.sql) once and enable email/password authentication. Existing installations of the earlier ShiftRescue schema should apply [`supabase/upgrade-drafts.sql`](supabase/upgrade-drafts.sql) instead of re-running the initial schema. The connected ShiftRescue project already has this upgrade.

### Installation

```bash
git clone https://github.com/DhruboImtiaz/shiftrescue.git
cd shiftrescue
npm ci
cp .env.example .env
```

### Environment Variables

Fill the local `.env` file privately:

```dotenv
GEMINI_API_KEY=your_google_ai_studio_key
GEMMA_MODEL=gemma-4-26b-a4b-it
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_project_publishable_key
PROPOSAL_SECRET=your_random_secret_of_at_least_32_characters
COOKIE_SECURE=false
PORT=5173
```

The local server generates `PROPOSAL_SECRET` if it is missing or still uses the example placeholder. To generate a separate value for deployment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The API is named the Gemini API, but the app selects a **Gemma** model explicitly. Check model access in your Google project; see the [hosted Gemma guide](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api). No Supabase service-role key is required.

### Run Locally

```bash
npm start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The empty local workspace and manual solver can run without cloud configuration. Sign in to save private events and, when cloud mode is enabled, use Gemma.

### Tests & Production Build

```bash
npm test
npm run check
npm run build
```

Tests cover scheduling rules, fairness, search budgets, model-response validation, sessions, ownership-related API behavior, stale writes, draft setup, signed previews and quota timing including daylight-saving boundaries. Test model responses are fixtures and do not consume live Gemma quota. GitHub Actions runs the checks on pushes and pull requests.

### Create an Event with Gemma

1. Sign in and choose **Describe event with Gemma**.
2. Include the event name/date, named volunteers with skills, availability and maximum hours, plus each shift’s time, staffing count and required skills.
3. Choose **Create draft with Gemma**. Unknown details remain blank; clarification questions appear above the editable draft.
4. Correct the draft, explicitly enter `none` where no skills or availability are intended, and resolve any questions.
5. Choose **Create event & preview schedule**. This saves a new event with no assignments, then checks coverage with the deterministic scheduler.
6. Review the proposal and choose **Apply repair** to save assignments. If coverage is impossible, adjust the saved team or shifts and generate again.

Example brief:

> Campus Help Day on 20 October 2026. Nadia has first-aid training; Rahim has no special skills. Both are available 10:00–14:00, maximum 4 hours each. Support desk: 10:00–12:00 and 12:00–14:00, one person per shift with first-aid coverage. Registration: the same two blocks, one person per shift, no special skills required.

Setup never overwrites the selected event. Editing the description invalidates its previous model draft, so generate a fresh draft before saving. Model output is validated on the server; reviewed fields are validated again before the cloud write. No database migration or additional environment variable is needed for this feature.

---

## Deployment

ShiftRescue is deployed at **[shiftrescue.netlify.app](https://shiftrescue.netlify.app/)** through Netlify. This project includes a backend; publishing only static files does not deploy its API.

### Netlify Configuration

Import this repository and deploy the `main` branch. The root `netlify.toml` supplies:

| Setting | Value |
| --- | --- |
| Base directory | Repository root |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node version | `22` |

### Private Server Settings

In **Netlify → Project configuration → Environment variables**, add:

- `GEMINI_API_KEY`
- `GEMMA_MODEL`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `PROPOSAL_SECRET`
- `COOKIE_SECURE=true`

Use the existing private service settings, rather than the example placeholders. Include the **Functions** scope and production deploy context. Mark credentials as secret values where available. Keep the signing secret stable across deployments; changing it invalidates pending previews without deleting saved events. `PORT` is only needed locally.

**Commit the code; configure credentials in Netlify.** The ignored local `.env` file is not uploaded through GitHub. After adding or changing environment variables, trigger a new production deploy so the functions receive them.

### Supabase Authentication URLs

In **Supabase → Authentication → URL Configuration**:

- Set **Site URL** to `https://shiftrescue.netlify.app`.
- Add `https://shiftrescue.netlify.app/**` to allowed redirect URLs when needed for confirmation links.
- Retain `http://127.0.0.1:5173/**` if local development is still needed.

Confirm signup emails when required, then return to the app and sign in. Accounts work across deployments, but a localhost browser session does not transfer to the public domain.

### Deployment Checks

1. `/api/auth/session` should report `configured: true` for Supabase.
2. `/api/status` should report `configured: true` for Gemma, without exposing a key.
3. Sign in, create an event, add a volunteer and shift, generate a schedule and apply it.
4. Reload the page and confirm the event is restored.
5. Send a real Gemma request, review the interpretation, then preview and apply the repair.

If sign-in says **“Supabase has not been configured on the server,”** check both Supabase environment variables in the production Functions scope, then redeploy. Do not fix this by adding credentials to source code. A missing Gemma key affects natural-language requests; a missing signing secret prevents cloud repair previews from being accepted.

Netlify’s request limit and Google’s model quota are separate. For quota timing, the app uses provider retry metadata and Google’s documented daily request refresh at midnight Pacific time. If the provider supplies no reset information, it displays that uncertainty. See [Netlify environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/) and [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

---

## Data Storage

- **Local workspace:** An unsaved local draft can be kept in browser storage. Signing in starts with an empty workspace; saved events remain available in the event selector. Sample rosters are not injected into accounts, and browser drafts are not automatically copied into a signed-in account.
- **Cloud workspace:** Events, volunteers, shifts, assignments and activity use five Supabase tables with row-level ownership policies. Queries run with the verified user’s identity; database functions use `SECURITY INVOKER`.
- **Sessions:** Auth tokens use HttpOnly, SameSite cookies, with Secure cookies on Netlify. Passwords and session tokens are not stored in browser local storage.
- **Accepted schedules:** Cloud saves are transactional and version-checked. Unconfirmed or failed repair requests preserve the accepted event. Setup edits that break coverage clear assignments into a draft until a valid schedule is generated.
- **AI requests:** Volunteer names, skills, availability and the coordinator’s message are sent to Google only when using Gemma. Event descriptions are kept in the current browser session for retry and cleared after creation. Raw descriptions are not added to the cloud activity log. Avoid unnecessary sensitive personal details.
- **Credentials:** Private environment files, credentials, local caches, dependencies, generated builds and backup artifacts are excluded by `.gitignore`. `.env.example` contains placeholders only. Never commit API keys or a Supabase service-role key.

---

## Roadmap / Known Limitations

- Each event supports **12 volunteers, 8 shifts and 1–3 people per shift** on one day in **Asia/Dhaka**.
- Event setup accepts descriptions up to **8,000 characters**. Existing-event change requests accept **3,000 characters** and **24 changes**, limited to unavailability and maximum-hour changes.
- Setup supports one day in Dhaka, exact shift intervals, staffing and collective skill coverage. Required breaks, travel time, fixed assignments, recurring events and other additional rules require clarification or manual restructuring; they are not enforced by the scheduler.
- Use exact names and 24-hour times. Ambiguous times, unknown people and unsupported dates require clarification.
- Repair previews expire after ten minutes. Refresh and regenerate previews after a stale-version conflict.
- The search has a time/node budget; a valid best-so-far solution may not be proved optimal.
- [ ] Shared coordinator workspaces and invitations.
- [ ] Volunteer availability collection and confirmed swaps.
- [ ] Calendar integration, recurring events and overnight shifts.
- [ ] SMS/email notifications.

---

## License

MIT — see [LICENSE](LICENSE). No model weights are distributed with the project.
