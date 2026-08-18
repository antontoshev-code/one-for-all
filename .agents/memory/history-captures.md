---
name: History captures table
description: Schema, API, and design decisions for the History feature (captures + capture_entries tables).
---

## Rule
Every time an inbox entry is accepted or split, a capture record is created so the user can trace back to the original wording.

## Why
Users may edit/delete entries after processing. The capture table preserves the original text and what it became.

## How to apply
- `capturesTable` (`lib/db/src/schema/captures.ts`) — id, content, captureType, createdAt.
- `captureEntriesTable` — captureId FK (cascade), entryId FK (set null on delete), categorySnapshot text.
- SET NULL means deleted entries show as "(deleted)" in History but the capture record stays.
- `POST /api/captures` is called fire-and-forget from `inbox.tsx` — not on the critical path.
- `GET /api/captures` returns captures newest-first with their linked entries.
- `POST /api/data/clear` deletes captureEntriesTable then capturesTable (after entryPeopleTable, before entriesTable).
- `GET /api/data/export` includes captures and captureEntryLinks (version "1.1").

## Category model decision (Log = body/health only)
Log was too broad (general "did things" → log). Changed to:
- **log**: workouts, sleep, eating, physical symptoms, medication, weight, heart rate.
- **journal**: default for everything else — general activities, weather, mood, observations.
Applied in: `heuristics.ts` `categorizeContent()`, `ai.ts` `heuristicCategory()`, and Claude system prompt.

## Name detection stoplist
Common 3-char sentence-starting verbs ("Met", "Ran", "Ate", "Saw") must be in NON_NAME_WORDS.
The detection loop now iterates all candidates and returns the first one with length ≥ 4, rather than
bailing at the first candidate. This lets "Met Marcus at the gym" correctly surface "Marcus".
