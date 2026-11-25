# Runbook: the 10:00 rush test (staging only)

v7.0 unit 6, "Reliable anywhere" (ROADMAP v2.1 unit 6; owner Q5–Q7, 14 Nov 2026). The question it answers
is whether 20 people starting their day in the same minute all get through quickly, as the team does at
10:00 IST.

**Never production.** The test runs on staging, after 22:00 IST, with 20 made-up people.
`scripts/lib/load-guard.mjs` refuses production's app (`*.maxoff.in` and its own Worker,
`maxoff.<account>.workers.dev`) and production's Supabase project. It also refuses any host other
than staging's Worker (`maxoff-staging`, or a `<branch>-maxoff-staging` preview of it) over https,
or this machine.

## Pass (owner Q6)

- **Every Start day goes through:** a 2xx from `attendance_start_day`, and the home screen answers 200
  afterwards.
- **None doubled:** each person has exactly one day today and exactly one `started` event, by the
  database's own count.
- **19 of 20 wait under 3 s.** The wait is the Start day call plus the home screen read again, which is
  the screen showing the started day.

Any compute upgrade the result suggests is the owner's cost decision, made with the numbers.

## The people

- There are 20 Crew members, `load-01@rush-test.invalid` … `load-20@rush-test.invalid`, named
  "Rush test 01" … "Rush test 20". `.invalid` never delivers, so no email ever reaches anyone. They
  have no push subscriptions.
- `load-test-people` creates the ones that are missing and reactivates the rest.
- `load-test-people-off` deactivates them again. **Nothing is deleted** (invariant 9).
- While deactivated, they never appear in the team's lists, and perf-probe's "first active member" never
  picks one.
- A day starts once per IST date, so the test runs **once per night** with this set.

## Running it (GitHub Actions → Preview → Run workflow, on `main` or the release branch)

1. Announce the run on the release issue, with the time.
2. **Before 22:00 IST:** run `load-test-people` to make or reactivate the people.
3. **After 22:00 IST**, Monday to Saturday and never while a speed probe is queued or running (check
   the Preview runs first; probe slots are the advisor's): run `load-test`.
   - It signs the 20 people in slowly first, one every 11 s, to stay inside GoTrue's limit of 30 sign-ins
     per 5 minutes per address. That takes about 4 minutes.
   - Then the 20 Start days are spread over 60 s.
   - The table goes into the job summary, and the raw JSON is kept for 30 days.
4. Run `load-test-people-off` to deactivate the people.
5. Copy the summary table into the release notes. **The first run is the baseline.**

## Locally, for correctness first (the decision sheet: "a local run against Docker comes first")

```sh
pnpm db:reset && pnpm build && pnpm start --port 3100 &
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SECRET_KEY=…   # from `pnpm exec supabase status`
node scripts/load-10am.mjs people --count 20
node scripts/load-10am.mjs run --base http://localhost:3100 --count 20 --spread 10 --pace 0
node scripts/load-10am.mjs people --count 20 --off
```

The local times say nothing about staging. Only the PASS on "none doubled" and "all through" carries
over.

## Reading the result

- The runner is in the US and staging is a shared free Supabase project, so the times measure the test
  bed as much as the app. Report staging's own perf-probe numbers from the same evening beside the
  result.
- A failure with `40P01` (deadlock) or `40001` in the JSON is a bug in the Start day transaction, not
  load. Fix it at the cause.
- What is not tested: the server action. The Start day goes through PostgREST with each person's JWT,
  which is the same transition function the button calls. The decision sheet's five real phone
  contexts tapping the button are a follow-up (PROGRESS, Ideas).
