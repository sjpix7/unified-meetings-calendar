# 🗓️ Unified Meetings Calendar

A small service to pull meetings from two systems, a CRM and a Calendar, figures out which records are of the same meeting, and serves a single merged list over a single REST API to be sent to the front end. A React calendar for a combined result.

It also helpsyou assess if any clashes with another meeting. In terms of time, location, status etc.

There's no database, storage or login. The two JSON files in `data/` stand in for the upstream APIs.

## Running it

You need Docker Desktop (or Docker Engine with Compose v2).

```bash
docker compose up --build
```

Then open http://localhost:3000.

- UI: http://localhost:3000
- API through the UI's nginx proxy: http://localhost:3000/api/meetings
- Backend directly: http://localhost:4000/api/meetings

## How it works

The logic lives in [backend/src/normalize.js](backend/src/normalize.js) and [backend/src/reconcile.js](backend/src/reconcile.js).

### Normalizing

It converts both sources into one common format so the rest of the app doesn't have to care where a meeting came from. If a field looks wrong It flag's it (info, warning or error depending on how bad it is). Sometimes it's pretty clear what the value was supposed to be, so I just fixed it, but still it flag's it, so it can be observed what changed.

### Duplicates within a source

Two Calendar events count as the same meeting if they're on the same day, have the same organizer, overlap in time, and share an external attendee or have a clearly similar title. The CRM version of the rule is the same owner and client with start times within an hour. I keep the most recently created record and attach the others to it as duplicates, which the UI shows.

### Merging

Every field stores its value, which source it came from (crm, calendar, both or derived), the raw value from each side, and whether the two disagree. Disagreements are settled by fixed rules (see below), but both values are always kept and shown.

### Clashes and overlaps

For every pair of timed, non-cancelled meetings that overlap, it's a clash if at least one person is in both (someone is double-booked) and an overlap if nobody is shared. Participants are the calendar attendees and organizer plus the CRM relationship owner.

## AI usage and time spent

Used Caude Opus 5.5 as the AI agent to get clarity for Backend logic and built the Frontend more correctly. Plus, to dockerize the app with a single build command.

**Time spent:** _\ 2 hours 30 mins_
