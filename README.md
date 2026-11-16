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
- Current member names and active status come from the original Supabase
  `members` table, the same live source used by the formation app. Source IDs
  are preserved, so renaming a player does not break existing duty assignments.
- The published JavaScript is parsed with Acorn (never executed) to discover
  the public backend configuration and game schedules. Its old first-name-only
  seed roster is used only for older source versions without a members table.
  If live members are unavailable, a running instance keeps its last successful
  names with an explicit stale warning instead of reverting to first names.
- It also reads the original app's publicly accessible, server-saved guest
  records from the past 90 days using the same public anon access as that app.
  Guest records retain their source IDs, so two records with the same name can
  appear separately. The interface labels them as guests.
- Live roster results are cached for 30 seconds per server instance. Visible
  clients check every 30 seconds and when returning to the app. This is polling,
  not an instant websocket subscription; cache timing can add another interval.
  **Sync roster** bypasses both the roster and bundle caches for an immediate
  source read. The larger published bundle is otherwise cached for five minutes.
  Newly added members, renamed players and deactivations update automatically.
  Duty lists also refresh every 30 seconds and on return to view.
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

Stored duty rows retain the assignee name captured at assignment time. The API
and interface show the current name by source ID when available, and fall back
to the stored name for a player no longer present in the current roster.

## iOS and Android

The updated native apps include a calendar icon in their top toolbar.

The calendar button opens **https://yolo-duty-app.vercel.app/** directly on both
platforms. No address entry or setup menu is required. The hosted page consumes
its shared `/api/roster` and `/api/duties` endpoints. Home returns to the original
YOLO pickup app. The calendar remains publicly editable without an admin key.

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
