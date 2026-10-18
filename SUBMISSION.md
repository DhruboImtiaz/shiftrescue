# ShiftRescue

## Tagline

Repair volunteer schedules when plans change, using Gemma to understand requests and a constraint solver to find valid cover.

## Inspiration

Campus events and community activities depend on volunteers. When someone becomes unavailable, a coordinator needs to check several constraints at once: who is free, who has the required training, who is already working, and who has reached their hour limit. A seemingly simple replacement can create another gap.

## What it does

ShiftRescue turns a message such as “Nadia cannot work from 14:00 to 16:00” into a reviewed availability change. It searches for a valid schedule that keeps reassignments small, displays the changes, and lets the coordinator accept the repair.

When a schedule cannot satisfy the constraints, it reports the conflict and preserves the accepted rota. An activity log, volunteer editor and CSV export make the result inspectable and usable.

## How we built it

The full-stack prototype uses a Node.js server and a responsive HTML/CSS/JavaScript interface. Supabase provides email/password accounts and PostgreSQL storage for events, volunteers, shifts, assignments and activity. Ownership policies isolate each coordinator's data. Session cookies are HttpOnly, and every database query runs with the verified user's identity.

Google's hosted Gemma interprets free-text requests through the Gemini API. All model output is validated before it reaches the scheduling engine. Accepted repairs are saved atomically against an expected event version, preventing an outdated tab from silently overwriting a newer rota.

The scheduler uses bounded backtracking with pruning. It enforces availability, staffing, skill coverage, no double-booking and hour limits. Its primary objective is to minimize changed assignments; workload balance breaks ties. Returned schedules are checked independently. The interface distinguishes a proved optimum from a best-so-far result and a search timeout from proved infeasibility.

The code uses Node.js, browser web standards and the pinned Supabase JavaScript library. Application source is provided under the MIT license. Google hosts the Gemma model; no model weights are distributed with the project.

## Challenges

Handling ambiguous language without silently guessing, keeping schedule changes small while satisfying interacting constraints, and explaining an impossible request without inventing a cause.

## Accomplishments

Custom event, volunteer and shift setup, quota-aware Gemma fallback, Netlify deployment support, a working live Gemma-to-schedule-to-Supabase flow, private saved events that survive reloads, a reproducible multi-reassignment example, explicit conflict handling, and 46 automated checks covering scheduling, AI-response validation and cloud sessions. Database tests also verify atomic saves, stale-write rejection and ownership isolation.

## What we learned

Natural-language understanding and constraint checking serve different roles. Keeping them separate makes an AI-assisted tool easier to inspect and its results easier to verify.

## What's next

Shared team memberships, availability collection, calendar integration and volunteer-confirmed shift swaps. The current prototype supports separate one-day events, each private to its coordinator account, and uses fictional demonstration data.

## Before submitting

- Add your team name. Repository: https://github.com/DhruboImtiaz/shiftrescue
- Upload screenshots or a short recording of the running app.
- Verify the precise model used by your API account and include it in the submission.
- Mention any coding assistants you used if the organizers request that disclosure.
- Ensure no API key is in the repository, screenshots or recording.
