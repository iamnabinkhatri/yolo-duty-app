# YOLO duty calendar

A separate, Vercel-ready web app matching YOLO's cream, teal and orange pickup
layout. Assign coffee, donuts, snacks, water, fruit, or a custom item to players
for a game date. Select multiple items for one player in one save, including
comma-separated custom items (up to ten total). Everyone can view, create, reassign,
mark brought, and remove duties. No login or admin key is required.

The web app and its API live in this `web` directory. They are independent of
Touchline. No original YOLO RSVP or player record is modified by this app.

## Run locally

Requires Node 20.19+ or 22+:

```sh
cd /Users/nabinkhatri/Documents/Programming/AI/YOLO/web
npm ci
npm start
```

Open http://127.0.0.1:4310. Local assignments persist in `.local/duties.json`.

For custom local settings, copy `.env.example` to `.env`, configure the values,
and use `npm run dev` to load the file. `npm start` reads existing environment
variables; it does not load `.env` automatically.

## Connect your separate Supabase project

1. Create or select the Supabase project for duty-calendar data.
2. Open its SQL editor and run [`database/schema.sql`](database/schema.sql).
   This creates `public.yolo_duties`, a unique assignment constraint, a date
   index, and row-level security. Browser roles get no direct access. The
   server-only key accesses the table through the duty API.
3. Obtain the project URL and a **server secret** key (`sb_secret_...`, or the
   legacy `service_role` key). An anon/publishable key cannot write this table.

The browser and mobile apps never receive your Supabase server secret. All duty


## Deploy to Vercel

You can deploy just this directory; a ZIP of the web source is also provided
alongside the project. Vercel requires a database configured as below before
shared assignment writes can work.

### Dashboard / Git import

Push the standalone YOLO project to your own Git repository and import it into
Vercel. Set **Root Directory** to `web` (or leave it as `.` if your repository
contains only this directory). Use **Other** for the framework; the committed
`vercel.json` specifies `public` as the output directory and a Node function for
the API. No frontend build command is needed.

Set these Vercel environment variables for Production (and Preview if needed):

| Variable | Value |
| --- | --- |
| `DUTY_SUPABASE_URL` | Your separate project's `https://...supabase.co` URL |
| `DUTY_SUPABASE_SECRET_KEY` | Its server secret or legacy service-role key |

Deploy after setting the variables. If you change them, redeploy so the running
function receives the new settings. The app deliberately returns 503 for duty
storage when production database settings are missing; it never pretends that
an ephemeral Vercel filesystem is a shared database.

### CLI alternative

From this directory:

```sh
npx vercel
# Set the two environment variables in the Vercel dashboard, then:
npx vercel --prod
```

Vercel account login and the Supabase project must be configured by their owner.
This repository contains no deployment token or database secret.

## Player synchronization

- The source is https://yoloformation.vercel.app/.
- Its core roster is currently embedded in its published JavaScript. The API
  discovers the current script URL and parses the roster's static syntax with
  Acorn; it **does not execute the third-party bundle**.
- It also reads the original app's publicly accessible, server-saved guest
  records from the past 90 days using the same public anon access as that app.
  Guest records retain their source IDs, so two records with the same name can
  appear separately. The interface labels them as guests.
- Source data is cached for five minutes per server instance. Clients poll the
  roster every five minutes, or anyone can use **Sync roster**. Newly
  published core players and server-saved guests then appear in the assignee
  list. Duty lists refresh every 30 seconds and when the app returns to view.
- A player saved only in somebody's browser local storage cannot be discovered
  by another app. Saving that player to the original backend (or publishing an
  updated core roster) is needed for synchronization.
- If the original bundle changes format, sync fails visibly rather than
  guessing a roster. A running instance retains its last successful roster and
  marks it stale. Cold instances cannot fabricate a fallback roster.
- If an official player endpoint is added later, set `YOLO_ROSTER_URL` to that
  HTTPS JSON URL. It should return `{ "players": [{ "id": "...", "name":
  "..." }], "schedules": [...] }`. Preserve source IDs. Schedule entries use
  `weekday` (0=Sunday), `time` (HH:mm), `location`, and `label`.

Game dates follow the published Thursday/Sunday slots. The Sunday time in the
original app is adjusted for sunrise; this calendar shows its nominal published
slot, so consult the Pickup screen for the final game time. Duties are assigned
to dates and are unaffected by that time adjustment.

Historical duty rows retain the assignee name captured at assignment time even
if that player later disappears from the current roster.

## iOS and Android

The updated native apps include a calendar icon in their top toolbar.

1. Deploy this web app to Vercel and note its HTTPS root address.
2. In each native app, tap **Duty calendar** and enter that same address.
3. The native app opens the hosted calendar; its web interface consumes the
   shared `/api/roster` and `/api/duties` endpoints on that deployment.
4. Anyone can assign, reassign, mark brought, or remove duties without a key.

The saved calendar address is per device. You can change it from the calendar
button's menu. Home still returns to the original YOLO pickup app. No native
rebuild is needed if you deploy to a new address; update the saved address.

## Checks

```sh
npm test
```

Tests cover public API access, unknown-player rejection, date validation,
duplicate assignment prevention, concurrent local writes, restart persistence,
CRUD, roster additions, stale upstream handling, and avoiding execution of the
original JavaScript. Local browser checks cover create, brought status,
reassignment and cleanup, using local test data only.

See [API.md](API.md) for endpoint contracts and examples.
# yolo-duty-app
