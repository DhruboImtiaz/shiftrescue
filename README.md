# ShiftRescue — Volunteer Schedule Rescue

> **A change of plans, handled.**

ShiftRescue helps volunteer coordinators create events and manage schedules one shift at a time. Start with text, English or Bengali speech, or a photo of an event roster. Review the extracted team, shifts and assignments, then save your progress while other places remain open. Describe later changes to add, remove, move or replace volunteers, with availability, overlaps, capacity and hour limits checked before saving.

Accounts start with an empty workspace. Create your own events, volunteers and shifts, or explicitly open an event you have saved. Supabase provides email/password accounts and private cloud storage; Netlify hosts the frontend and backend.

**Live:** [shiftrescue.netlify.app](https://shiftrescue.netlify.app/)

## Start using ShiftRescue

1. Sign in, then choose **Create from text or photo**. Type an event brief, use **Tap to talk**, or upload/take a roster photo. Add notes to explain unclear columns or missing details.
2. Review the event, volunteers, shifts and assignment preview. Correct names and times, complete missing details, then choose **Create event**. This creates a separate saved event.
3. Use **Edit assignments** at the bottom-right of a shift card, or describe a change in **What changed?** Review the interpretation and preview, then **Save changes**. Open places can stay open; **Complete schedule** is optional.

---

## Features

### Event & Team Management

- Start with zero volunteers and shifts, then create separate events with a name and date or copy a roster you have opened.
- Add, edit and remove volunteers with custom skills, multiple availability windows and maximum daily hours.
- Define shifts with staffing requirements and required skill coverage.
- Save incomplete schedules and build them one volunteer at a time. Each shift has an Edit assignments button; completing the whole event is optional.

### Gemma-Powered Requests

- Create a new event from a description or roster photo with its name, date, volunteers, skills, availability, hour limits, shifts and explicit assignments.
- Review and edit every extracted field, add or remove draft rows, and resolve missing details before saving a separate event to Supabase.
- Review imported assignments during setup, or add assignments afterward. Complete schedule remains optional; incomplete events stay editable.
- Interpret requests such as **“Nadia cannot work from 14:00 to 16:00.”**
- Add, remove, move or replace volunteers on existing shifts, for example **“Assign Nadia to Support desk 10:00–12:00,” “Move Nadia from Support desk to Registration,”** or **“Replace Nadia with Rahim on Registration.”** Review and save those changes without filling other shifts. Capacity, availability, overlaps and hour limits are enforced; missing staffing or skill coverage remains visible as a warning.
- Only requested placements change; unrelated assignments are preserved. Moves and replacements are atomic. Include shift times when names are ambiguous. The optional Complete schedule action can fill remaining places or rebalance the event.
- Support multiple unavailable intervals and maximum-hour changes in one message.
- Ask for clarification instead of guessing ambiguous times or unknown people.
- Validate structured model output before it reaches the scheduling engine.

### Tap-to-Talk in English and Bengali

- Use **Tap to talk** below either the event brief or **What changed?** Select **English**, **বাংলা (বাংলাদেশ)**, or **Auto detect** for mixed speech.
- Allow microphone access, speak for up to 30 seconds, then choose **Stop & transcribe**. **Cancel recording** discards the recording without changing your text.
- The transcript is appended to the editable text box. Check names and times before sending it to Gemma; voice input never interprets, assigns or saves automatically.
- Google’s `gemini-3.5-transcribe` handles speech recognition with the existing private `GEMINI_API_KEY`; the configured Gemma model still interprets event and schedule requests. Model access and quota for transcription must be available on that Google connection.
- Audio is sent to Google only after stopping a recording. ShiftRescue does not store audio, and requests use `store: false` in the transcription API. The selected event’s existing names and shift labels provide vocabulary hints after ownership is checked.
- Recording requires microphone permission and a browser with `getUserMedia` and `MediaRecorder` over HTTPS (or localhost). Unsupported browsers and transcription failures keep typed input available. Audio is limited to 1 MiB. The photo route has its own image limit; other JSON routes retain the existing 80 KB limit.

Language support: [Google transcription model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe). Exact recognition depends on pronunciation, background noise and names; the transcript is always editable.
- Review the interpretation and resulting repair separately before applying changes.

### Constraint-Based Scheduling

- Check full-shift availability, staffing, required skills, overlapping assignments and total hours.
- Minimize replacements in the existing schedule, then use workload balance to break ties.
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

1. Sign in and choose **Create from text or photo**.
2. Include the event name/date, named volunteers with skills, availability and maximum hours, plus each shift’s time, staffing count and required skills.
3. Choose **Create draft with Gemma**. Unknown details remain blank; clarification questions appear above the editable draft.
4. Correct the draft, explicitly enter `none` where no skills or availability are intended, and resolve any questions.
5. Review the assignment preview, then choose **Create event**. The new event is saved with your selected assignments; other places can stay open.
6. Use a shift’s **Edit assignments** button, or describe an assignment in **What changed?** Choose **Preview changes → Save changes**. Other shifts can remain unfilled, even if a complete schedule is currently impossible.
7. Optionally choose **Complete schedule → Apply complete schedule** to ask the constraint engine to fill the entire event.

Example brief:

> Campus Help Day on 20 October 2026. Nadia has first-aid training; Rahim has no special skills. Both are available 10:00–14:00, maximum 4 hours each. Support desk: 10:00–12:00 and 12:00–14:00, one person per shift with first-aid coverage. Registration: the same two blocks, one person per shift, no special skills required.

Setup never overwrites the selected event. Editing the description or changing/removing its photo invalidates the previous model draft, so generate a fresh draft before saving. Model output is validated on the server; reviewed fields and imported assignments are validated again before the cloud write. No database migration or additional environment variable is needed for this feature.

### Create an event from a photo

Choose **Create from text or photo**, then **Upload photo** or **Take photo**. On supported mobile devices, Take photo opens the camera; on other devices it may open a file picker. Use a clear JPG, PNG or WebP image of a roster, timetable or event poster. Export HEIC photos as JPG first. One image per draft is supported, with optional text or voice notes to clarify the image.

The browser accepts source images up to 20 MiB, applies their orientation and re-encodes them as JPEG (up to 2,400 pixels on the longest side, 2 MiB). This removes original file metadata. The selected photo stays in browser memory; it is sent to Google's image-capable Gemma 4 model only when **Create draft with Gemma** is pressed. ShiftRescue does not store the original image in browser storage, event state or its database. Google processes the submitted image under the existing Google connection's applicable data terms. No public image URLs or Files API uploads are used.

Gemma extracts event/date, volunteers, availability, hour limits, skills, shifts and explicit assignments from English, Bengali or mixed content. Unknown or illegible fields stay blank and require review. A written assignment does not establish broader availability or an hour limit. Handwriting and ambiguous table layouts need particular care; recognition is not guaranteed. A non-roster image should produce clarification rather than invented event data.

The review includes editable assignment checkboxes and a partial schedule preview. Capacity, availability, overlapping shifts and hour limits block invalid imports. Open places and missing collective skill coverage are warnings, so a valid partial schedule can be created. Creating a draft never saves or overwrites an event; **Create event** saves only the reviewed fields and selected assignments as a new event.

The authenticated `/api/setup/photo` endpoint alone accepts up to 2.9 MB of JSON, with a 2 MiB decoded image limit and base64/type/signature validation. Other setup endpoints retain their 80 KB request limit. Image interpretation shares Gemma's quota, retry and error handling with text requests.

Photo production check: select a clear roster with known placements, generate and edit its preview, create the separate event, then reload and reopen it. Confirm extracted names/times and placements match the source; leave at least one shift place open to verify partial saving. Also try a missing-detail image, a rejected file type and Remove photo. Test camera capture on the target phone/browser after deployment.

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
3. Sign in, create an event with several shifts, and save one volunteer to one shift while the others remain open.
4. Reload the page and confirm the event is restored.
5. Send a real Gemma add, remove or move request, review the proposed edits, then preview and save. Confirm unrelated placements are preserved.
6. Use **Create from text or photo → Upload photo** with a clear roster containing explicit assignments. Check extracted names, dates, times and placements in the editable preview; save a separate event with open places, then reload and reopen it.
7. Use **Tap to talk** for an English and a Bengali request. Confirm the transcript is editable and nothing is interpreted or saved until you explicitly continue. Test **Take photo** on the target phone/browser.
8. Confirm the interface uses “schedule” consistently and each shift’s **Edit assignments** button is at the bottom-right, including empty cards and phone layouts.

If sign-in says **“Supabase has not been configured on the server,”** check both Supabase environment variables in the production Functions scope, then redeploy. Do not fix this by adding credentials to source code. A missing Gemma key affects natural-language requests; a missing signing secret prevents cloud repair previews from being accepted.

Netlify’s request limit and Google’s model quota are separate. For quota timing, the app uses provider retry metadata and Google’s documented daily request refresh at midnight Pacific time. If the provider supplies no reset information, it displays that uncertainty. See [Netlify environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/) and [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

---

## Data Storage

- **Local workspace:** An unsaved local draft can be kept in browser storage. Signing in starts with an empty workspace; saved events remain available in the event selector. Sample rosters are not injected into accounts, and browser drafts are not automatically copied into a signed-in account.
- **Cloud workspace:** Events, volunteers, shifts, assignments and activity use five Supabase tables with row-level ownership policies. Queries run with the verified user’s identity; database functions use `SECURITY INVOKER`.
- **Sessions:** Auth tokens use HttpOnly, SameSite cookies, with Secure cookies on Netlify. Passwords and session tokens are not stored in browser local storage.
- **Saved assignments:** Cloud saves are transactional and version-checked. Partial schedules can be saved; staffing and skill gaps remain visible until filled. Unconfirmed or failed edits preserve the saved event. Team/shift edits keep unaffected placements and reopen only assignments that no longer fit. Full schedule generation remains a separate action.
- **AI requests:** Volunteer names, skills, availability and the coordinator’s message are sent to Google only when using Gemma. Selected photos are sent only when creating a photo draft; recordings are sent only after stopping transcription. Original images and audio are not stored in the event database. Event descriptions are kept in the current browser session for retry and cleared after creation. Raw descriptions are not added to the cloud activity log. Avoid unnecessary sensitive personal details.
- **Credentials:** Private environment files, credentials, local caches, dependencies, generated builds and backup artifacts are excluded by `.gitignore`. `.env.example` contains placeholders only. Never commit API keys or a Supabase service-role key.

---

## Roadmap / Known Limitations

- Each event supports **12 volunteers, 8 shifts and 1–3 people per shift** on one day in **Asia/Dhaka**.
- Event setup accepts descriptions up to **8,000 characters**. Existing-event change requests accept **3,000 characters** and **24 operations**: adding/removing shift assignments, unavailability and maximum-hour changes. Moves and replacements use a removal plus an addition.
- Setup supports one day in Dhaka, exact shift intervals, staffing, collective skill coverage and explicit initial assignments from text or a roster photo. Review those assignments before creating the event; later edits use **Edit assignments** or **What changed?** Required breaks, travel time, permanent assignment locks, recurring events and other additional rules require clarification or manual restructuring; they are not enforced by the scheduler.
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
