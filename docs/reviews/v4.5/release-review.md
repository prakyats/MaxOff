# MaxOff v4.5 "Upload link": release review

Branch `phase-v45`. Two read-only reviewers, each started without the builder's conclusions:

- an architecture review of the day's commits (c57761b9..40866fed);
- the once-per-release design passes:
  - `design:design-critique`, loaded;
  - ux-copy, accessibility and design-system, run with the same intent;
  - Impeccable is not available in this environment.

The design passes looked at 32 screenshots of the Uploads card, the uploader's sheet, the All files received sheet and the public `/upload` page, at 375, 430 and 1280 px.

Every must-fix and should-fix is fixed, with a test.

## Architecture (26 Nov)

| # | Level | Finding | Outcome |
|---|---|---|---|
| A1 | must-fix | `hasNul` walked the body recursively before any rate limit. A 64 KB body nested ~32,000 deep would overflow the stack and answer 500 on every call. | Fixed (02c3fa77): an explicit stack. Unit test with such a body. |
| A2 | should-fix | `core/drive/endpoints` read `NEXT_PUBLIC_APP_ENV` through a parameter, so the build didn't inline it, and on the Worker the local-only gate read "local". Still harmless: no Worker has the secret, and loopback hosts are refused. | Fixed (02c3fa77): reads the inlined value. Unit test. The same pattern in `spaceGuard(process.env)` is logged in PROGRESS tech debt. |
| A3 | should-fix | Next's header matcher ignores case, so `/Upload` skipped the global CSP while the proxy didn't treat it as the upload page. `X-Frame-Options: DENY` still applied. | Fixed (02c3fa77): `isUploadPagePath` matches any case. Unit test. |
| A4 | should-fix | ARCHITECTURE §18.3 and `.env.example` had not caught up. | Fixed (02c3fa77). |
| A5 | should-fix | The pen test didn't mask the members' session tokens or end the sessions. | Fixed (02c3fa77): masked; the run's own sessions end (scope `local`). |
| A6 | nit | The header test uses Next's internal path matcher, not the Worker's. | Kept: pen test M17 checks the Worker itself. |
| A7 | nit | The pen test leaves its staging tasks open. | Logged in PROGRESS; the links are stopped and nothing is deleted. |

Also answered:

- the Google override can't take effect on staging or production;
- the header split leaves every other path with `frame-ancestors 'none'`;
- the 404 catch-all shadows no route;
- the pen-test job can't reach production and prints no secret;
- the module boundaries hold.

## Design (26 Nov)

| # | Level | Finding | Outcome |
|---|---|---|---|
| D1 | must-fix | Uploader sheet at 375 px: names and times split mid-word ("setup-guid / e.exe", "7:15 / am"). | Fixed: the row is a grid, so on a phone the chips sit under the name and the name has the row's width. Names wrap only where they must. A no-break space keeps "7:15 am" together (unit test). |
| D2 | must-fix | Colour rule: the solid "All files received" was Forest even when its sheet's commit is neutral (it only tells the primary owner). | Fixed: Forest only when the sheet marks Done, neutral `strong` otherwise. e2e for both cases. |
| D3 | should-fix | Outsiders saw "MaxOff" on the bad-link and busy screens. | Fixed: with no studio known, the header shows none. e2e asserts no "MaxOff". |
| D4 | should-fix | "the task's primary" is jargon. | Changed to "the task's primary owner" in the card, the sheet and the guide. |
| D5 | should-fix | Idioms in the daily-limit and keep-open text. | Plainer wording, same meaning. |
| D6 | nit | Outsider's file list cut long names to one line. | Two lines, wrapped, so the extension stays visible. |
| D7 | nit | "Send more files" stretched across a laptop screen. | `md:w-auto`, like the other dock buttons. |
| D8 | nit | "cameraman". | "camera operator", in the card and the guide. |
| D9 | nit | "Not on this task · new name" in one chip; "Link active" in blue. | Kept as built: blue reads as files moving. Raised for the Owner's walk. |

Checks that passed:

- the mobile standard: 16 px inputs, 44 px targets, bottom sheets, a sticky primary action, cards;
- one solid action per layer on the public page;
- `core/ui` components only;
- labels and `role="alert"` on errors;
- grey chip contrast about 5:1.
