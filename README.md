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

Used Claude Opus 5.5 as the AI agent to get clarity for Backend logic and built the Frontend more correctly. Plus, to dockerize the app with a single build command.

**Time spent:** _ 2 hours 30 mins_

## The backend, explained in simple words

Imagine two grown-ups who each keep their own list of playdates. **Mom writes hers in a notebook.** That's the CRM. **Dad keeps his on his phone.** That's the Calendar. Lots of playdates are on both lists, but written a bit differently. Some are written twice by accident, and some have mistakes. The backend's job is to make **one clean list** that everyone can trust.

### The helpers (files)

| File | Who it is in the story |
|---|---|
| [config.js](backend/src/config.js) | **The rule card on the fridge:** "We live in New York time," "a playdate lasts 1 hour if nobody says," "grown-ups at our office have `@firma.com` emails," "you need 5 points to say two playdates are the same." |
| [server.js](backend/src/server.js) | **The front door.** When someone knocks and asks "what are the meetings?", it gets the answer and hands it over. |
| [ingest.js](backend/src/ingest.js) | **The fetcher.** Goes and gets both lists. |
| [normalize.js](backend/src/normalize.js) | **The cleaner.** Rewrites every playdate the same tidy way. |
| [reconcile.js](backend/src/reconcile.js) | **The matcher.** Finds which playdates are the same one, puts them together, and spots when someone is in two places at once. |
| [text.js](backend/src/text.js) | **The word-game kid.** Good at telling whether two names or titles mean the same thing. |

### Step 1: Fetch the lists (ingestion)

Someone knocks on the door ([server.js](backend/src/server.js)) and asks for `/api/meetings`. The fetcher ([ingest.js](backend/src/ingest.js)) then:

1. Opens `crm_events.json` (Mom's notebook) and `calendar_events.json` (Dad's phone).
2. Checks that each one is really a list. If a file is scribbled nonsense (not valid JSON), it stops and says so.
3. Gives every playdate to the cleaner, one by one.
4. Gives the clean lists to the matcher.

The lists are read fresh **every time someone asks**, so if you change the files, the next question gets the new answer.

### Step 2: Clean everything up (normalization)

Mom and Dad write things differently:

- **Mom (CRM)** writes a date and a time, like `03/15/2026` and `14:00`, and never writes when it ends.
- **Dad (Calendar)** writes full start and end times, like `2026-03-15T14:00:00`.

The cleaner ([normalize.js](backend/src/normalize.js)) turns both into the **same shape**: title, date, start, end, location, virtual or in person, status, people.

Every time it sees something odd, it writes a **sticky note** called an issue. Each note has a color:

- 🔵 **info:** "Just so you know." Example: this time was written in a different time zone, so I changed it to New York time.
- 🟡 **warning:** "I fixed something." Example: `03-15/2026` is a funny date, so I read it as March 15. Or `sarah [at] firm [dot] com` is a hidden email, so I fixed it to `sarah@firm.com`.
- 🔴 **error:** "I can't use this." Example: there's no date at all, so I can't put it on the calendar.

More things the cleaner does:

- `canceled` and `cancelled` mean the same thing, so it picks one spelling.
- If the status is missing, it guesses "scheduled" and writes a sticky note.
- If the end time comes before the start time, it ignores the end time and writes a sticky note.
- A client name like "TBD" or "Various" isn't a real person, so it's cleared out.
- Mom writes "Sarah Chen" but Dad writes emails. The cleaner guesses `sarah.chen@firma.com` so they can be matched later.
- If the location says "Zoom" or "Teams", it's **virtual**. Otherwise it's **in person**.

The important rule: **it never throws anything away quietly.** Every fix gets a sticky note.

### Step 3: Match them up (reconciliation)

The matcher ([reconcile.js](backend/src/reconcile.js)) does four things.

#### 3a. Find the accidental copies

Sometimes Dad put the same playdate in his phone twice. Two Calendar entries are the **same one** if:

- they're on the same day, **and**
- the same person set them up, **and**
- their times overlap, **and**
- they have the same outside friend (a non-`@firma.com` email), **or** their titles sound alike.

For Mom's notebook it's similar: same owner, same client (or similar title), and starting within an hour of each other.

When it finds copies, it keeps **the newest one** (most likely the updated invite) and staples the older ones behind it, so you can still see them.

#### 3b. Play the points game to match Mom's list with Dad's

For each pair (one from Mom, one from Dad), the matcher gives points:

| Clue | Points |
|---|---|
| Start times within 15 min | +3 |
| Within an hour | +2 |
| Within 3 hours | +1 |
| Mom's client is on Dad's invite | +4 ⭐ |
| The client's company shows up in the emails or title | +2 ⭐ |
| The owner is on the invite | +1 |
| The titles sound alike | up to +3 ⭐ |
| The locations agree | +1 |

Two rules:

1. They must be on the **same day**, or it's zero points.
2. They need at least one ⭐ clue, meaning a reason to think it's the same *people*. Otherwise two different playdates at 2pm could get glued together by mistake.

**5 or more points with a ⭐ means it's a match.** The biggest scores get matched first, and each playdate can only be matched once.

The word-game kid ([text.js](backend/src/text.js)) helps with the titles. It ignores filler words like "the", "meeting" and "call", and it knows that "QBR" means "Quarterly Business Review".

#### 3c. Glue each matched pair into one playdate

When Mom and Dad disagree, there are fixed rules:

- **Time and location:** trust Dad's phone (Calendar), because that's the invite people actually got.
- **Who the client is, and whether it's a client or internal meeting:** trust Mom's notebook (CRM), because that's what she tracks.
- **Status:** if **either** says cancelled, it's cancelled. A cancellation should never be hidden. If either says tentative, it's tentative.
- No end time anywhere? Assume 1 hour.
- No time at all? Show it as an all-day item.

Every field remembers **where it came from** (`crm`, `calendar`, `both` or `derived`) and **what each list said**. Even when one side wins, you can still see what the other side said. Disagreements become **conflicts** marked low, medium or high. For example, a start time that's 30 or more minutes apart is high.

Playdates with no partner are kept too, marked `crm_only` or `calendar_only`. Ones with no date at all go in an **unplaced** pile, so they're never lost.

#### 3d. Is anyone in two places at once?

The matcher lines up all playdates by start time (skipping cancelled ones) and checks which ones overlap:

- **Clash:** the same person is in both. They're double-booked. 😬
- **Overlap:** they happen at the same time, but nobody is in both. That's fine, it just helps to know.

### Step 4: Hand back the answer

The front door ([server.js](backend/src/server.js)) gives back:

- **`meetings`:** the one clean list
- **`clashes`:** who's double-booked
- **`unplaced`:** playdates that couldn't go on the calendar
- **`summary`:** counts, like how many matched, how many were copies and how many conflicts
- **`firmPeople`:** everyone from the office, for the "view as" picker

You can also ask for:

- `?person=email`: just one person's playdates
- `?conflicts=true`: just the ones where Mom and Dad disagree
- `/api/meetings/:id`: one playdate
- `/api/sources/crm` or `/api/sources/calendar`: the original, uncleaned lists, so you can check the work

### The whole thing in one line

**Fetch both lists → clean them into the same shape (with sticky notes) → staple copies together → play the points game to pair them → glue pairs with fixed rules → find double-bookings → hand it all back.**
