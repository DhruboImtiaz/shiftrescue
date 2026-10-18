# ShiftRescue: two-minute demo

## Before presenting

- Start the app with `npm start`.
- Open http://127.0.0.1:5173 and confirm **Gemma connected**.
- Sign in to your ShiftRescue account. Click **Open local demo** or **Reset demo**, then **New event → Copy the current team, shifts and rota** to create a fresh presentation event.
- Verify **Saved to Supabase · version 1**. Avoid showing passwords or `.env` in a recording.
- Rehearse the live request with your current model and quota.

## 0:00 — The problem

“When a volunteer cancels, the coordinator has to check who is free, who has the right skills, and who is already working. One replacement can force several other changes. ShiftRescue repairs the schedule while keeping those changes small.”

Show the eight-person team and the six-shift rota. Explain that the support desk needs a first-aid-trained volunteer. Point out that the event is stored privately in Supabase.

## 0:25 — The AI input

Type: **Nadia cannot work from 14:00 to 16:00.**

Click **Understand request**.

“This is a real call to Gemma. It translates the message into a specific volunteer and unavailable time interval. I review that interpretation before using it.”

## 0:45 — A checked repair

Click **Confirm & find cover**.

“The scheduling engine now checks availability, overlapping shifts, skill coverage and hour limits. It finds a valid replacement with one changed assignment.”

Show the before/after names. Click **Apply repair**. Point out the highlighted person, version 2 in the cloud toolbar and the activity entry. Refresh the app to show that the accepted rota is restored from Supabase.

## 1:10 — The difficult case

Load the **ripple-effect** scripted scenario and confirm its constraints.

“This scenario is predefined for demonstration; the actual solver still runs. Mehedi is the only person who can cover the late support shift, but he has a two-hour limit. The engine must also replace his earlier assignment.”

Show both reassignments.

## 1:35 — Knowing when it cannot work

Load **No qualified cover available** and confirm.

“When all qualified volunteers are unavailable, it explains the missing first-aid coverage and preserves the current schedule.”

## 1:50 — The distinction

“Gemma makes requests easy to express. A constraint solver checks whether the schedule works. The coordinator reviews the result before it is applied.”

## If asked about limitations

“Each event is one day and private to its coordinator account. The prototype uses fictional data and supports availability and hour-limit changes. A next version could add shared team memberships, calendars and volunteer-confirmed swaps.”
