# Deploy ShiftRescue on Netlify

## 1. Import the repository

In Netlify, choose **Add new project → Import an existing project → GitHub**, then select `DhruboImtiaz/shiftrescue` and the `main` branch.

The repository’s `netlify.toml` supplies:

| Setting | Value |
| --- | --- |
| Base directory | Repository root (leave blank) |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node version | `22` |

This is a full-stack deployment. A static-only drag-and-drop of `dist` will not deploy the API.

## 2. Set private environment variables

Before deploying, add these values in Netlify **Project configuration → Environment variables**. Include the **Functions** scope if your plan exposes scope controls; otherwise use all scopes. Apply them to the production deploy context.

```dotenv
GEMINI_API_KEY=your_google_ai_studio_key
GEMMA_MODEL=gemma-4-26b-a4b-it
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_project_publishable_key
PROPOSAL_SECRET=your_random_secret
COOKIE_SECURE=true
```

Use the values from your private local `.env` for the existing services. Generate `PROPOSAL_SECRET` once with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep it stable across deploys. Changing it invalidates pending repair previews but does not erase saved events. Do not put secrets in `netlify.toml`, commit `.env`, or prefix these values with a browser/public prefix. No service-role key is needed.

You do not need `PORT` on Netlify. The deployed function always uses secure auth cookies. The function does not write to a filesystem or depend on a particular server staying alive.

## 3. Check the Supabase schema and email settings

The connected ShiftRescue database is already configured. For a new Supabase project, run `supabase/schema.sql` once; do not run the existing-install upgrade after a fresh schema install.

After Netlify supplies the real site address, open Supabase **Authentication → URL Configuration**:

- Set **Site URL** to `https://YOUR-SITE.netlify.app`.
- Add `https://YOUR-SITE.netlify.app/**` to allowed redirect URLs if needed for confirmation links.
- Keep `http://127.0.0.1:5173/**` only if you still need local development.
- Add a custom domain separately if you later use one.

Email/password sign-in is the supported account method. For a newly created account, confirm the email and return to the app to sign in. Existing confirmed accounts continue to work on the deployed site, but the local browser session is not transferred between domains.

## 4. Deploy and verify

Trigger the Netlify deploy. Environment changes require a fresh deploy to reach the deployed functions.

Check these on the HTTPS site:

1. `/api/status` returns JSON with `configured: true` and the chosen Gemma model. It must not return an API key.
2. Sign in, then create an empty event.
3. Add a volunteer, add a compatible shift, generate a schedule, and apply it.
4. Reload the page and confirm that the event and accepted schedule remain.
5. Send one real availability change through Gemma and review its interpretation.
6. Check the repair preview, apply it, and confirm that the cloud version advances.
7. In a second tab, try applying an outdated preview. It should ask for a refresh instead of overwriting new work.

Quota handling has automated coverage; do not deliberately exhaust your real key to test it. The Gemma panel shows retry/refresh timing from provider metadata and labels unknown timing honestly. The manual generator remains available.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `/api/status` is 404 or returns HTML | Confirm the repository/function directory deployed, rather than only static assets |
| Gemma is unconfigured | Check `GEMINI_API_KEY` in the Functions environment, then redeploy |
| Sign-in says Supabase is unconfigured | Check both Supabase variables and redeploy |
| Preview fails with a signing-secret message | Set a random `PROPOSAL_SECRET` of at least 32 characters, then redeploy |
| Signup confirmation opens the wrong site | Update Supabase’s Site URL and allowed redirect URLs |
| Quota reached | Read the timing in the Gemma box; check the model’s actual quota in AI Studio |
| Newer event version exists | Refresh the cloud copy and regenerate the preview |
| Preview expired after a deploy | Generate a fresh preview; keep the signing secret stable |
| “No valid schedule” | Check availability, people count, skills, overlaps and total hours |

The model call times out at 45 seconds, within Netlify’s documented 60-second synchronous function limit. A model timeout preserves the accepted event. Netlify’s own per-IP API limit may also temporarily return `429`; that is a site request limit and is not mislabeled as Gemma quota.

References: [Netlify Functions API](https://docs.netlify.com/build/functions/api/), [function limits](https://docs.netlify.com/build/functions/configuration/), [environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/).
