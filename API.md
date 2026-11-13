# Duty calendar API v1

Base URL: your deployed calendar's `/api`. JSON over HTTPS. Roster and duty
reads are public, matching the shared calendar. All reads and mutations are public. No authentication or admin key is required.
POST/PATCH requests use `Content-Type: application/json`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/config` | Storage mode and public runtime configuration; no secrets |
| GET | `/api/roster` | Current source players, schedules and sync status |
| GET | `/api/roster?refresh=1` | Force roster refresh |
| GET | `/api/duties?month=2026-11` | Duties in a calendar month |
| POST | `/api/duties` | Create an assignment |
| PATCH | `/api/duties/:id` | Change assignee, note, or brought status |
| DELETE | `/api/duties/:id` | Remove an assignment |

## Roster

```json
{
  "players": [{ "id": "core-name", "name": "Name", "kind": "member" }],
  "schedules": [{ "weekday": 4, "time": "19:30", "location": "Pleasant Park", "label": "Thursday" }],
  "source": "https://yoloformation.vercel.app",
  "syncedAt": "2026-11-12T12:00:00.000Z",
  "stale": false,
  "guestsSynced": true
}
```

`kind` is `member` or `guest`. Submit the exact source `id` when assigning a
duty. `stale: true` means the last successful roster is being returned because
the original source is temporarily unavailable. `guestsSynced: false` means
the core roster is usable but live guests could not be fetched.

## Create a duty

```json
{
  "game_date": "2026-11-12",
  "items": ["Coffee", "Donuts", "Snacks"],
  "player_id": "<id from /api/roster>",
  "note": "Two flasks, including decaf"
}
```

Response: `201 { "duties": [{ ... }, { ... }, { ... }] }`. Select 1–10
items per request. The insert is atomic: if one item conflicts, none of the new
items is saved. Each item gets a separate row and can be marked brought or
reassigned independently. The server supplies `id` (UUID),
`player_name`, `status: "assigned"`, `created_at` and `updated_at`. Submitted
`player_name` values are ignored; names come from the current source roster.

One player cannot be assigned the same item twice for one date (case
insensitive). Multiple players may share an item; one player may bring multiple
items. Each item is 1–60 characters; optional `note` is at most 500 characters
and is copied to each selected item. Case-insensitive duplicate items in a
single selection are rejected.

For existing clients, a singular `"item": "Coffee"` request remains supported
and returns `201 { "duty": { ... } }`.

## Update

```json
{ "status": "done" }
```

or:

```json
{ "player_id": "<another current roster id>", "note": "Bring cups too" }
```

Response: `200 { "duty": { ... } }`. Status is `assigned` or `done`.
Game date and item are immutable through PATCH; remove/recreate if those need
to change. DELETE returns `200 { "deleted": true }`.

GET duties returns `{ "duties": [...] }`, ordered by date then item.
The default month is the current month in America/New_York. Month/date strings
are validated, including leap years and month rollover.

## Errors

Errors use `{ "error": "message" }` with HTTP status 400 (validation),
404 (missing endpoint/assignment), 409 (duplicate),
413 (body too large), 415 (content type), 502 (upstream roster unavailable), or
503 (duty backend configuration unavailable). No database keys or
raw upstream responses are returned.

The current native apps load this deployment directly, so all API requests are
same-origin. If a future native client calls JSON directly, configure its exact
origin(s) in `DUTY_ALLOWED_ORIGINS`, comma separated. Do not put the Supabase
server key in a mobile binary or browser bundle.
