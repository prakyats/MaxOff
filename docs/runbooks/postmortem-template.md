# Postmortem: <short title>

Copy this file to `docs/postmortems/YYYY-MM-DD-<short-name>.md` and fill it in within a few days of the
incident (`incident.md`, "After any incident"). Blameless: it is about what happened and how to stop it
happening again, never about who. No secrets, no personal data beyond first names, no money figures.

- **Date:** YYYY-MM-DD (IST)
- **Written by:**
- **Status:** draft / reviewed by the Owner

## What happened

Two or three sentences a Crew member would understand.

## Impact

- **Who noticed:** which roles (Owner, Admin, Crew), how many people.
- **What they could not do:** for example "no one could Start day from 09:10 to 09:40".
- **Data:** was anything lost, wrong or shown to the wrong person? (Money shown to anyone but the Owner is
  always a serious incident: invariant 2.)
- **How long:** from the first sign to fully fixed.

## Timeline (IST)

| Time | What happened |
|---|---|
| HH:MM | First sign (alert, report) |
| HH:MM | Someone started looking |
| HH:MM | Cause found |
| HH:MM | Fixed (rollback / new tag / other) |
| HH:MM | Team told it is fixed |

## Cause

What went wrong, and why it was able to. Keep asking "why" until the answer is something we can change.

## How it was found

Alert (UptimeRobot, Sentry, a GitHub issue), a person, or by chance? If by a person or by chance, which
alert should have caught it?

## The fix

What was done on the day, and which release or rollback carried it. Link the PR and the run.

## Follow-ups

| Action | Owner of the action | Where it is tracked |
|---|---|---|
| | | PROGRESS "Ideas / tech debt", a ROADMAP item, or a PR |

## What went well

So we keep doing it.
