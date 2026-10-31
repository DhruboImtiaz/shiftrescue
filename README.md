# ShiftRescue — Volunteer Schedule Rescue

AI-assisted volunteer planning for when plans change. Turn a description or roster photo into an event, build a schedule, and preview changes before saving.

Each event supports **80 volunteers, 24 shifts and 1–8 people per shift** on one day in **Asia/Dhaka**.

[Live site](https://shiftrescue.netlify.app/) · [Detailed setup and operations guide](docs/guide.md)

## Start using ShiftRescue

1. Sign in or create an account from the home page.
2. Choose **New event**, or create an editable draft from text, a photo, or English/Bengali voice notes.
3. Review the team, availability, skills and shifts. Assign people individually or choose **Complete schedule**.
4. Describe later changes in **What changed?**, review the preview, and save when ready.
5. Use **Share event** to invite other coordinators, or **Join event** to request access with their code.

## Features

### Event & Team Management

Create separate events, copy an accessible event, and edit volunteers, availability, skills, hour limits and shift requirements. Incomplete schedules can stay open while you fill places one at a time. Saved events reopen across devices and can be recovered from Trash.

### Shared Events & Access Requests

- Every event has a unique code. The owner copies it from **Share event** and sends it to another user.
- Signed-in users enter the code in **Join event** and request **View** or **Edit** access. A code permits requests; access requires approval.
- The owner reviews each requester's name, username, circular profile photo and bio, then grants either role or rejects the request.
- Approved events appear under **Shared with me** in the event selector. Owners can change roles, remove access and reset the code. Resetting a code keeps existing memberships.

| Role | Permissions |
| --- | --- |
| Viewer | Read the event, volunteers, schedule and activity; export the schedule |
| Editor | Also edit event settings, volunteers, shifts and assignments |
| Owner | Also review requests, manage access, delete and restore the event |

Shared changes are checked every five seconds while the page is visible. Idle workspaces update automatically; unsaved forms and previews show **Load latest** instead. Version checks prevent stale saves from overwriting newer work. Activity records identify the coordinator who saved a change.

### Gemma-Powered Requests

Google's hosted Gemma extracts event drafts from text or roster photos and interprets changes such as “Nadia cannot work 14:00–16:00” or “Move Rahim to Registration.” Review and edit the result before saving. Ambiguous details require clarification; AI never grants access or saves automatically.

### Tap-to-Talk in English and Bengali

Record up to 30 seconds in English, বাংলা or automatic language mode. Google's transcription model appends editable text to the event brief or change request. Check the transcript before interpreting it. Microphone permission and HTTPS or localhost are required.

### Constraint-Based Scheduling & Quota Fallback

The deterministic scheduler checks staffing, availability, overlaps, required skills and maximum hours. Manual assignments stay available if AI quota is exhausted. A bounded search keeps larger events responsive; reaching its limit does not prove no valid schedule exists.

### Cloud Storage, Profiles & Export

Supabase stores events and account profiles. **My account** lets users edit their name, username, phone, optional bio and circular profile photo. Event owners can preview requesters' and members' profile details; email and phone stay private. Export schedules as CSV.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Interface | Browser JavaScript, HTML and CSS |
| API | Node.js / Netlify Functions |
| Accounts, data and photos | Supabase Auth, Postgres and private Storage |
| AI and speech | Google Gemini API for hosted Gemma and transcription |
| Verification | Node tests and local Postgres permission tests with PGlite |

## Getting Started

### Prerequisites

**Node.js 22+**, a Supabase project, and a Google AI Studio key with access to the configured models for AI features.

### Installation

```sh
npm ci
cp .env.example .env
```

### Environment Variables

Fill in `.env`; never commit it or expose privileged Supabase keys.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public/publishable client key |
| `GEMINI_API_KEY` | Private Google AI Studio key |
| `GEMMA_MODEL` | Default: `gemma-4-26b-a4b-it` |
| `PROPOSAL_SECRET` | Stable random secret, at least 32 characters |
| `COOKIE_SECURE` | `false` locally; HTTPS/Netlify uses secure cookies |

### Database Setup

- **New database:** run [supabase/schema.sql](supabase/schema.sql) once and enable email/password sign-in.
- **Existing database:** apply pending [migrations](supabase/migrations) in order, including `event_collaboration` before deploying shared-event code. Do not rerun the initial schema. The migrations preserve existing events.
- Configure Supabase Auth's Site URL and allowed redirect URLs for your deployment. See the [guide](docs/guide.md) for older installations and email confirmation.

### Run Locally

```sh
npm start
```

Open [localhost:5173](http://127.0.0.1:5173). The workspace is at `/workspace.html`. Local scheduling can run without cloud configuration; accounts and sharing require Supabase.

### Tests & Production Build

```sh
npm test
npm run check
npm run build
```

Tests cover API access restrictions and actual Postgres policies for owners, editors, viewers, outsiders and anonymous users. Permission tests run locally without live accounts or credentials.

## Deployment

Connect the repository to Netlify. [netlify.toml](netlify.toml) configures the build, static files and API function. Set the environment variables above in the Functions scope and keep `PROPOSAL_SECRET` stable. Apply database migrations before deploying dependent code.

See the [guide](docs/guide.md) for deployment checks, profile storage, quota recovery and troubleshooting.

## Saved Events, Dates and Trash

Events remain saved after their date passes. Owners can move events to Trash and restore them with the team, assignments and history intact. Shared access is unavailable while an event is in Trash; editors and viewers cannot delete or restore it.

## Data Storage

Access is checked using the signed-in user's identity and database permissions. Memberships, requests and event codes live in a private database schema. Contact details remain private, and profile photos use a private Storage bucket. Sessions use HttpOnly cookies. Original roster photos and recordings are sent to Google only for the requested AI operation and are not stored in the event database.

## Roadmap / Known Limitations

- One day in Asia/Dhaka; recurring events, overnight shifts, breaks and travel rules are not supported.
- Setup text allows 32,000 characters; change requests allow 3,000 characters and up to 384 operations. Moves use a removal and an addition.
- Previews expire after ten minutes. Regenerate them after conflicting edits or permission changes.
- Difficult schedules can reach the search budget. AI imports depend on provider deadlines, response limits and quota; manual setup remains available.
- Join attempts are rate limited; rejected or revoked users must wait a minute before requesting again. Events accept up to 500 pending requests at once.
- Future work: volunteer availability collection, confirmed swaps, calendar integration and notifications.

## License

[MIT](LICENSE)
