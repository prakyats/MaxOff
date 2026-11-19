# v4.5 "Upload link": security review plan

Status: **plan only, for the Owner and the advisor to approve before anything is built.** No migration or app code exists for v4.5. The UI sample is `docs/design/v45-upload-link-sample.html`. Its "Questions for the owner" box holds the business questions. This plan holds the security requirements, the checks and the tests.

## 1. Why v4.5 needs its own review

Until now, every write to MaxOff came from a signed-in member. The upload link is **MaxOff's first surface that anyone can write to without logging in** (#89 6879244245). Production has been live since 2026-10-01. A mistake here could:

- let strangers fill the studio's 2 TB Drive;
- plant harmful files where an Admin will open them;
- leak a client's or a task's details;
- flood Admins with notifications;
- expose the studio's Google access.

The review runs in four passes:

| Pass | When | Who | Output |
|---|---|---|---|
| R0 Design | Before the build. This plan and the sample, plus a half-day spike (§4 E0) | advisor + builder, Owner approves the leftover risks | This plan, amended; DATA-MODEL / PERMISSIONS / WORKFLOWS drafts; a new ADR (§9) |
| R1 Per unit | At each unit boundary | builder (`security-review` skill on the diff) + a reviewer subagent | Findings fixed before the next unit; listed in PROGRESS |
| R2 Pre-release | On the release branch, staging only | builder runs the pen-test checklist (§7.4); advisor checks the results | A table in the READY post: each item passed, or failed and fixed |
| R3 After release | First 7 days in production | advisor | Logs and notifications checked for abuse or errors; anything found goes in PROGRESS |

## 2. The decisions this plan depends on

| Ref (#89) | What it settles |
|---|---|
| 6878907953 | Personal Gmail with 2 TB, not Workspace; `drive.file` scope only; the account can be switched later |
| 6879199286 | Files others upload into a *shared* folder stay theirs, so the browser sends bytes to a **resumable session opened by the studio account**; avoid "anyone with the link can edit" |
| 6879244245 | Per-task private link: no login, add-only, expiring, one task folder, Admin notified; "first unauthenticated write surface: unguessable token, rate limits, size and type checks, audit, revoke" |
| 6879293330 | The Owner accepts a link reachable without login; to verify: CORS and authorisation on the session URL, resume after a drop, limits |
| **6879421505** (spec) | Drive-like page; bytes never through MaxOff or R2; link lives **until the task is done or cancelled**; one link per task; typed names; 15-min stuck alert; **any type, any size**; warn on low space; folders kept on a laptop; audit **who, IP, files**; revoke; no R2 copy (ADR-0010 changes) |
| 6879494745 | Anyone with the link may upload; someone not on the task is flagged and the Admin told once; uploaders see nothing and get no notifications; **no listing, editing or deleting** |
| 6879555186 | "I'm done" is optional; "uploads look finished"; the Admin's "All files received" stops the link and marks Done only through the coordinator path (invariant 6) |
| v4.0 as built | `core/drive`: AES-256-GCM tokens at rest, never in the browser; folders MaxOff / Clients / client / YYYY-MM / task; `drive.manage` Owner-only; space alerts |

The sample's owner questions (Q1 to Q13) change some details below. Each such point is marked **[Qn]**.

## 3. What could go wrong

| Who | What they want | Main defences |
|---|---|---|
| Someone who guesses or scans links | Upload anything, learn about tasks | 256-bit tokens; one answer for every bad link; rate limits (A, C) |
| Someone who got a forwarded link | Read the shoot, fill the Drive, pose as an assignee | No listing; names are claims, flagged; space guard; Stop link (A, B, C) |
| A malicious uploader | Harmful files, XSS through file names, phishing the Admin | Names cleaned and shown as text; risky types flagged; MaxOff never serves the bytes (D, G) |
| A careless uploader | Damaged or partial files | Size and checksum checked with Google, not the browser's word (F) |
| A signed-in Crew member or another Admin | See the folder link or files of a task that isn't theirs | RLS and functions per role, pgTAP (H) |
| Anyone reading logs | Find the link or personal data | Token kept out of URLs sent to servers; logs scrubbed; IP erased (A, I, J) |

## 4. Requirements, point by point

Each row says what must be true, what it depends on, and how it is proved (P = pgTAP, U = unit, E = Playwright, M = manual pen test, §7). Table and function names are proposals; DATA-MODEL is written first.

### E0. Spike before the build (half a day, staging and a test Google account)
Google's documentation doesn't settle these (6879293330), and the whole design rests on them:
1. A browser can `PUT` chunks to a Drive resumable session URI with **no auth header**, and the response carries CORS headers for our origin when the server sent `Origin` in the initiating request.
2. A status query (`Content-Range: bytes */<size>`) resumes correctly after a dropped connection and after a page reload.
3. `X-Upload-Content-Length` set by the server is enforced: Google refuses more bytes than declared.
4. The server can query the same session itself, to learn the bytes received and the final file id.
5. Whether a session can be cancelled (a `DELETE` on the session URI). Expect "no"; the design below assumes it can't.
6. Session lifetime (Google documents about one week) and the error codes for: storage quota full, the ~750 GB/day upload limit, rate limits.
7. Throughput from a browser with 2–3 files in parallel against Drive's own web upload of the same file (the speed gate, 6879421505).

**If (1) fails,** bytes would have to pass through the Worker. That contradicts the spec ("never through MaxOff's server"), so the advisor stops and asks the Owner. Nothing else in this plan is built until E0 passes.

### A. The link token

| # | Requirement | Depends on | Proof |
|---|---|---|---|
| A1 | The token is **32 random bytes** (256 bits) from the Worker's CSPRNG, written as base64url (43 characters). | 6879244245 "unguessable" | U: length, alphabet, uniqueness over 10⁵ |
| A2 | **The database stores only `sha256(token)`** (unique index). Lookup is by hash. A database leak alone gives nobody a working link. | brief | P: no column holds a token; API roles can't select the hash |
| A3 | **Copy link at any time** without storing the token: the token is `HMAC-SHA256(UPLOAD_LINK_KEY, link_id ‖ link_secret_salt)`, recomputed by the server for the Owner or the task's Admin only. `UPLOAD_LINK_KEY` is a new Worker secret (`.env.example` with a comment; `deploy.yml` uploads it like the Drive secrets: an owner-approved production change). Rotating the key kills every link: documented. *Alternative if refused:* the link is shown once at creation, and "Make a new link" is the only way to get it again. | sample §1 (Copy link) | U: derive/verify; P: `upload_link_secret()` refuses Crew, other Admins, anon |
| A4 | **One task only.** A link row has exactly one `task_id`. Every public call resolves the task from the link, never from the request. There are no other ids in the public API. | 6879244245 "scoped to one task folder" | P; M4 |
| A5 | **Alive** = not stopped, and the task is not Done, Completed or Cancelled. It is checked **in the database function** at every resolve and every new file session, never only in the app. Done, cancel, Stop link, All files received and Make a new link each stop it in the same transaction as the change. **[Q9]** A task sent back after Done does not revive the link. | 6879421505 "until done or cancelled"; 6879555186 | P: each path stops the link; a stopped link refuses resolve and session; E |
| A6 | **One answer for every bad link.** Unknown, stopped, done, cancelled and malformed links all get the same response and the same page: no task title, no studio name, status 404, timing alike. | no listing | E: sample screen L for each case; M1 |
| A7 | **No listing.** The public API has no call that returns another uploader's data, any file list beyond the caller's own device, the folder, the client or the assignees. **[Q4][Q5]** | 6879494745 | P: what `upload_resolve()` returns (exact key set, like pgTAP 144's block check); M7 |
| A8 | **The token never reaches a server log.** The link is `…/upload#<token>`. The fragment isn't sent on page load, in `Referer`, or to link-preview bots (WhatsApp shows a generic "Upload files" card). The page's script reads it and sends it in a header (`Authorization: UploadLink <token>`) on POST calls only, then removes it from the address bar. | brief; ARCHITECTURE §18.2 (logs keep URLs) | E: no request URL contains the token; M2 |
| A9 | **Revocation is immediate** for new work: one database write, and the next call refuses. Sessions already handed to a browser **can't be revoked at Google** (E0.5). Files that finish after the stop are kept and marked `after_stop` for the Admin. **[Q8]** | 6879494745 "revoke" | P; E; M5 |
| A10 | **No hard time limit beyond the task**, as decided. Mitigation for long-open tasks: the Uploads card shows "Link made 34 days ago". *Conflict noted in §9.* | 6879421505 vs 6879244245 "expiring" | n/a |

### B. Uploaders and the device key

| # | Requirement | Depends on | Proof |
|---|---|---|---|
| B1 | **A typed name is a claim, not an identity.** The Admin view says so ("name typed by the uploader, not checked"). Matching it to an assignee only decides the "not on this task" flag. It never grants anything. (Q3, owner 19 Nov: no phone number is asked for or used.) | 6879494745 | U: matching rule; E |
| B2 | Name: 1–60 characters after trimming, Unicode NFC. Control characters, zero-width and **bidi override characters** are stripped. | XSS / spoofing | U: sanitiser table; M8 |
| B3 | **Device key:** 32 random bytes made by the browser and kept in that browser's storage for this link. The server stores its hash. It ties a returning uploader to their own uploader row and their own file list **[Q4]**, and nothing more. A copied key shows only that uploader's own list: accepted, documented. | 6879421505 "coming back later" vs no listing | P; U; M16 |
| B4 | **"Already sent" is checked only against the same uploader's files** (name + size), so it can't be used to test whether the shoot contains a given file. | no listing | P |
| B5 | Uploaders get **no notifications, no account, no MaxOff session and no cookies.** The public API ignores any MaxOff session cookie it receives. | 6879494745 | E: a signed-in member using the link gets no member rights through it |

### C. Rate limits and abuse

The decision is "any type, any size" (6879421505), so the limits are **safety limits a real shoot never meets**. They are not business caps. The numbers are proposals for R0, tuned on staging.

| # | Limit | Proposal | Where |
|---|---|---|---|
| C1 | Bad-link attempts per IP | 10 per minute, then 15 minutes refused (same page as A6) | Cloudflare Workers rate-limit binding (confirm it's on the plan) + a database counter |
| C2 | Link opens per IP | 60 per minute | same |
| C3 | New uploader names per link | 20 a day; the 21st is refused and the Admin is told once | DB function |
| C4 | Parallel file sessions per device | 6 (the page uses 2–3) | DB function |
| C5 | New file sessions per link | 600 an hour, 5,000 a day | DB function |
| C6 | Progress reports | 1 per file per 5 s; extra ones are dropped | Worker |
| C7 | Request body size on the public API | 64 KB (metadata only; bytes go to Google) | Worker |
| C8 | Space guard **[Q11]** | No session for a file larger than (free space − 10 GB reserve). It is "held", and the Owner is told once per link per day. The free space comes from the v4.0 storage read, cached for 5 minutes, and is never shown to the uploader. | DB function + `core/drive` |
| C9 | Google's daily limit **[Q10]** | Google's error pauses new sessions for that link with backoff (15 min, then 1 h). The Owner and the task's Admin are told once a day. | Worker |
| C10 | Notification flood | Not-on-task: once per name per link, at most 5 a day per link, then one summary. Stuck: once per stall per uploader. Looks finished: once per quiet period. | DB function |
| C11 | Folder depth and count (laptop) | Path depth ≤ 12, segment ≤ 120 characters, ≤ 2,000 folders per uploader | Worker + DB |
| C12 | Kill switch | Owner, Settings → Google Drive: "Pause all upload links" (every link answers "doesn't work right now"). *A small addition; Owner to confirm.* | DB flag checked in A5 |

Proof: unit tests for each limit's rule; pgTAP for C3–C5, C8 and C10; M11 and M12 script each limit on staging.

### D. Harmful files

MaxOff never sees the bytes (6879421505), so **MaxOff cannot scan them.** Google Drive scans files on download only up to a size limit (about 100 MB, to confirm in E0); most video can't be scanned.

| # | Requirement | Proof |
|---|---|---|
| D1 | **MaxOff never serves an uploaded file**: no `/api/files` route, no proxy, no thumbnail, no preview, no inline SVG or HTML. The Admin opens files in Google Drive (Google's own domains, sandboxed from MaxOff). ARCHITECTURE §11's "SVG and HTML are never served" holds trivially. | E: the live-view network log has no request for file content; M15 |
| D2 | File and folder names are **text only** everywhere (React text nodes, notification text, push payloads, History, email fallback). They are never put in a URL or an attribute without encoding, and never in `dangerouslySetInnerHTML`. | U: render tests with hostile names; M8 |
| D3 | **[Q13]** The Admin's list shows the **full** name and its last extension. Executable or web types (`exe msi bat cmd com scr ps1 vbs js jar apk dmg pkg lnk html htm svg xhtml hta`) and double extensions get a grey "Check before opening" chip. Nothing is blocked (decision). | U: classifier table |
| D4 | The Drive file's name is the cleaned name (B2 rules, plus `/` and `\` removed). MaxOff sets its MIME type from the browser's claim only as a hint; Drive decides. | U |
| D5 | The guide tells Admins: open footage in Drive's player; don't download and run anything from an upload folder. | guide review |

### E. The Google resumable-upload session

| # | Requirement | Depends on | Proof |
|---|---|---|---|
| E1 | **The browser never sees a Google access or refresh token, or the studio's address.** The Worker opens each session with the studio's `drive.file` access token (v4.0 `core/drive`) and returns **only the session URI**. | ADR-0010 "tokens never reach the browser"; v4.0 | U: response shape; M14 (search every response and bundle for `ya29.`, `1//`, the account address) |
| E2 | **The server fixes everything about the file** when it opens the session: the name (cleaned), the parent (`task folder / uploader folder / relative path`, folders made by the server), `X-Upload-Content-Length` = the declared size, a description linking to the task (ADR-0010), and `fields=id,size,md5Checksum,parents`. The browser can't change any of it with the session URI. | 6879199286 | E0.3; M4, M5 |
| E3 | **One session per file, opened just in time** (when that file is about to start), so few live session URIs exist at once. | limit exposure | U |
| E4 | **The session URI is a bearer credential for one file for about a week.** The server stores it **encrypted** (AES-GCM, as Drive tokens) only so it can check status (F2). It is never logged, never in an API response except to the device that asked, never in Realtime or History. | E0.6 | P: column not readable by API roles; M2 |
| E5 | **Revoke can't kill a session** (A9). A file that completes after a stop is kept, flagged `after_stop`, and shown to the Admin. **[Q8]** | 6879494745 | P; E |
| E6 | CSP `connect-src` allows only `'self'` and `https://www.googleapis.com` (J1). | | E: header test |
| E7 | **Drive disconnected or needs reconnecting** (v4.0 state): no session opens. The uploader sees sample screen R, the Admin's card says so, and the Owner's existing reconnect notice covers it. | v4.0 | E with the fake Drive |
| E8 | **Studio account switched** (v4.0 "Use another account"): links keep working, and new files go to the new account's folders. Files in the old account stay there and the Admin's list says which account holds them. | 6878907953 | P; U |
| E9 | **Staging and e2e never touch the studio's Drive.** CI uses a fake Drive (as MinIO stands in for R2). Staging uses a separate test Google account. | CLAUDE.md production rules | config review |

### F. Integrity and completion

| # | Requirement | Proof |
|---|---|---|
| F1 | **Google's answer is the truth, not the browser's.** When the browser says "done", the server queries the session itself (E0.4) for the final file id, then `files.get` for `size`, `md5Checksum`, `parents` and `trashed`. The file is marked received only if the size equals the declared size **and** the parent is the expected folder. A browser report with another file id is ignored. | U with the fake Drive; M6 |
| F2 | **Checksum.** The page computes MD5 as it reads each chunk (in a Web Worker; each byte is read once anyway) and sends it with "done". It is compared with Drive's `md5Checksum`. A mismatch marks the file "Failed: damaged on the way" and asks to retry. Where hashing would slow a phone below the speed gate (measured in E0.7), the file is checked by size only and marked so for the Admin. *Advisor decision at R0.* | U: incremental hash = one-shot hash; E |
| F3 | **Stuck detection uses Google's numbers.** The every-minute cron asks Google how many bytes each open session has (E0.4) when the browser has been silent. "Stuck" = no new bytes at Google for 15 minutes (6879421505). | U: rules; P: one alert per stall |
| F4 | **"Looks finished"** = every started file of that uploader is received and nothing has moved for 10 min **[Q12]** (6879555186). | U; P |
| F5 | **All files received** is one transition function: permission + scope + stop the link + (coordinator path: the existing Done function, unchanged) or (Crew primary: a notification) + `activity_log`, in one transaction. Invariants 5 and 6 are untouched. | P: every path, every role |

### G. Audit and notifications

| # | Requirement | Proof |
|---|---|---|
| G1 | `activity_log` rows, written by the functions: link made, copied (by whom; this helps trace a leak), new link, stopped (by whom and why: Stop link, All files received, task Done, cancelled, kill switch); uploader started (name, the not-on-task flag); file received (name, path, size, checksum, Drive id, `after_stop`); file failed for good; "I'm done"; stuck and looks-finished signals sent; files received; file removed **[Q7]** (who, reason; moved to the Drive bin, never deleted). | P: one row per path, exact fields |
| G2 | **Who, IP, files** (6879421505): the IP, user agent and device-key hash live in `upload_uploaders` / `upload_sessions`, **not in `activity_log`**, so erasing them after 90 days **[Q12]** never rewrites history (invariant 9). | P: the erase job nulls only those columns |
| G3 | The actor of a public action is the uploader row (`actor_kind = 'uploader'`), never a member. | P |
| G4 | Notifications follow WORKFLOWS §9 (new kinds written there first). Recipients: the task's Admin (creator, approving Admin, coordinator) and the Owner when the Owner runs the task; the Crew primary gets only "Files received: mark it done"; space and daily-limit notices go to the Owner. **The link, Drive ids and the folder link never go in a notification to Crew.** The folder link goes to the Owner and the task's Admin only. **[Q1][Q6]** | P: recipients per kind; E |
| G5 | Notification text is built in the database with the cleaned name (B2) and plain text only. Push payloads hold the title and the task id, nothing more. | U; M8 |

### H. Permissions, RLS and what members see

| # | Requirement | Proof |
|---|---|---|
| H1 | New tables (proposed `upload_links`, `upload_uploaders`, `upload_files`, `upload_sessions`) have **RLS in the same migration**. Select: the Owner and the task's Admin (and the coordinator) only. **Crew, freelancers, other Admins and anon read nothing.** No API role can insert, update or delete; every write goes through a function. | P: every role, allowed and denied, every table |
| H2 | The public API runs on the Worker with the **service role**, after its own token check, calling `service_role`-only functions (`upload_resolve`, `upload_register`, `upload_session_open`, `upload_progress`, `upload_file_done`, `upload_said_done`). `anon` and `authenticated` get no grant on them. | P: anon, Crew and Admin refused |
| H3 | Member actions (`upload_link_create`, `_stop`, `_renew`, `_secret`, `upload_files_received`, `upload_file_remove`) check permission and scope **[Q1]**. The permission key is new or reuses `tasks.create` + scope: PERMISSIONS first. | P: Owner, task Admin allowed; another Admin, Crew, freelancer, the coordinator of another task, anon, another org denied |
| H4 | **Money is untouched** (invariant 2). No amount in any upload table, notification or response. | P: pgTAP 46's money list unchanged |
| H5 | **The live view.** ARCHITECTURE §10a says nothing polls on a timer, and the spec asks for a live view. *Advisor decision at R0:* (a) poll the card's own read every 5 s **only while something is uploading and the card is on screen**, as a written exception; or (b) add `upload_files` to the Realtime publication (pgTAP 46's "only these tables" changes; RLS must hold on Realtime). Either way: no read is added to a shared layout (speed gate). | E; P (for b) |
| H6 | The folder link and the Drive file ids are in the Owner and Admin reads only. The Crew task page's network log has none of them. | E: network-log assertion, as `billing.spec.ts` does |

### I. Privacy (DPDP Act 2023 and its Rules)

The personal data is about uploaders who are **not MaxOff members**. To confirm with the Owner's own adviser; this is not legal advice.

| # | Requirement | Depends on |
|---|---|---|
| I1 | **Notice before collection**, on the name step (sample screen A): what is kept (name, files, IP and device), why (to know who sent what and to keep the link safe), for how long, and who to contact. A "How we use this" page with the studio's contact for questions, corrections and erasure. **The Owner supplies the contact.** | 6879421505 audit (who, IP, files) |
| I2 | **Collect the minimum:** name (required), IP, user agent, device-key hash. No phone (Q3, owner 19 Nov), no email, location or fingerprinting. No analytics or third-party scripts on the page. | |
| I3 | **Retention [Q12]:** IP, user agent and device hash erased after 90 days by a daily job. The name and file list stay as the task's history (the studio's business record). | invariant 9 (history kept) |
| I4 | **Erasure on request:** the Owner can clear an uploader's network details from the uploader sheet. The name in history is kept unless the Owner decides otherwise. | |
| I5 | **Processors:** Google (Drive holds the files), Cloudflare (Worker and logs), Supabase (database). Worker and Sentry logs carry no token or device key (A8, J4). | |
| I6 | **Footage itself** often shows people; that's the studio's existing processing. v4.5 doesn't change it, and the files sit in the same Drive as today. | |
| I7 | **A leaked link** is handled by Stop link / Make a new link, a History row, and a check of who uploaded through it. The steps go in the Owner's guide. | |

### J. CSP and headers on the public page

The upload page is a **separate, minimal page**: no app shell, no Supabase client, no Realtime, no service-worker control, no manifest, its own small bundle (a first-load JS budget entry in `bundle-budget.json`).

| # | Header or rule | Value |
|---|---|---|
| J1 | `Content-Security-Policy` | `default-src 'none'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://www.googleapis.com; worker-src 'self' blob:; manifest-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` (needs nonce support for this route; the rest of the app keeps today's list) |
| J2 | `Referrer-Policy` | `no-referrer` (stricter than the app's `strict-origin-when-cross-origin`) |
| J3 | `Cache-Control` | `no-store` on the page and every `/api/upload/*` answer |
| J4 | Logging | Sentry on this page: no replay, the `Authorization` header and device key scrubbed, URL fragment never captured |
| J5 | `X-Robots-Tag` | `noindex, nofollow` **in production too** (unlike the rest of production, §18.3) |
| J6 | Isolation | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy` denying camera, microphone, geolocation, payment, USB |
| J7 | API | POST only, JSON only, no `Access-Control-Allow-Origin` (same origin), no cookies read or set |
| J8 | Service worker | The app's service worker doesn't control or cache `/upload` (scope or an explicit bypass). Proved by e2e. |
| J9 | Origin *(advisor and Owner decision at R0)* | Serving the page on its own subdomain (for example `upload.maxoff.in`, the same Worker) keeps a member's MaxOff session cookies away from the public page entirely. It needs a DNS and route change in production: owner-approved. Same origin works with J1–J8; the separate origin is the stronger choice. |

Proof: `e2e/upload-headers.spec.ts` asserts the exact values against a real build, as `production.spec.ts` does; `scripts/smoke-deploy.sh` gains `/upload` checks; M17.

## 5. Making the stops safe

| Event | Link | Sessions already open | Notice |
|---|---|---|---|
| Admin: Stop link | stopped at once | finish; flagged `after_stop` | none to uploaders; the page shows sample screen M on its next call |
| Admin: All files received | stopped | as above | Crew primary: "mark it done" (or Done via coordinator) |
| Primary marks Done / task cancelled | stopped in the same transaction | as above | none extra |
| Make a new link | old stopped, new made | as above | none |
| Kill switch (C12) | all paused | as above | none |
| Drive needs reconnecting | alive, but no new session | browser retries | the Owner's existing notice |

## 6. Rollout guards (production rules)

- Migrations are **expand-only**: new tables and functions, nothing renamed or dropped. ADR-0010 is amended by a **new ADR** (§9), not edited in place.
- The feature does nothing until the Owner's Drive is connected (v4.0) and a link is made. There is no backfill.
- No `v*` tag or production secret is set by a session. `UPLOAD_LINK_KEY` and any DNS change (J9) are the Owner's.
- The speed gate: the upload page and the task page (Owner, Admin) probed; plus the large-file test against Drive's own web upload (6879421505).

## 7. How each point is tested

### 7.1 pgTAP (new files; every role allowed and denied)
- RLS on each new table: Owner, the task's Admin, the coordinator, another Admin, Crew assignee, Crew not on the task, freelancer, anon, another organisation.
- `upload_resolve`: alive / stopped / task Done / Completed / Cancelled / unknown hash give the same not-found; the exact key set returned (A7).
- `upload_register`: name rules, the not-on-task flag, matching an assignee, the C3 cap, one notification per name.
- `upload_session_open`: link alive, C4/C5 limits, C8 space guard, folder path rules, kill switch.
- `upload_file_done`: size match, parent match, `after_stop`, idempotent on a retry.
- `upload_files_received`: coordinator path marks Done through the existing function; Crew primary path notifies; invariant 6 refusals (another Admin, Crew not primary); the link stops.
- `upload_file_remove` **[Q7]**: reason required, history row, nothing deleted.
- Stuck and looks-finished jobs: once per stall, recipients per kind.
- Erasure job: nulls only the network columns; history unchanged.
- Each task transition (Done, cancel) stops the link.
- pgTAP 00's internal-function list and 46's Realtime / money lists updated.

### 7.2 Unit
Token make / hash / derive (A1–A3); name, path and file-name cleaning, including bidi and NUL (B2, D4, C11); the risky-type classifier (D3); the upload state machine (waiting → uploading → paused → resumed → done / failed, retry with backoff); resume offset from a status query; ETA and the overall line; "already sent" matching (B4); MD5 incremental = one-shot (F2); stuck and looks-finished rules (F3, F4); each rate-limit rule (C); the CSP builder (J1); the session-open request built with the fixed metadata (E2); `files.get` verification (F1) against the fake Drive.

### 7.3 Playwright (a fake Google upload server in CI; 1280, 375 and 430)
- The uploader flow on phone and laptop: name → choose → upload → done → I'm done (sample A–I); folders kept on the laptop.
- `context.setOffline(true/false)` mid-file: it resumes from the server's offset and sends no byte twice (the fake counts).
- Reload mid-upload: "welcome back" shows only this device's files (J); a second browser context with the same link sees none of them.
- Each bad link (stopped, done, cancelled, unknown, malformed) shows the one screen (L); no request URL contains the token (A8).
- Space held (N), daily limit (O), rate limit (Q), Drive disconnected (R), a failure and Retry (G).
- The Admin's live view: rows, the not-on-task flag, stuck, looks finished, the uploader sheet, Remove **[Q7]**, Stop link, Make a new link, All files received on both paths; each sheet's **installed back-gesture spec at 375 and 430** (§14.2).
- Crew task page: no Uploads card data, and no folder link in the network log (H6).
- The headers spec (J).
- `loading.tsx` for the Uploads card's skeleton (traced).

### 7.4 Manual pen-test checklist (staging only, a test Google account; never production)

| # | Try | Expect |
|---|---|---|
| M1 | 200 random tokens, malformed tokens, a real token with one character changed | Same page and timing; refused for 15 minutes after 10 a minute |
| M2 | Look for the token in Worker logs, Sentry, the `Referer` to googleapis.com, a WhatsApp preview, the server's access log | Nowhere (only the uploader's own browser history holds it) |
| M3 | Use a link after Stop, after Done, after cancel, after Make a new link, calling the API directly with curl | Refused at resolve and at session open |
| M4 | Send `../`, absolute paths, 500-character names, NUL, RTL override, emoji, a 50-deep folder, `parents` or `taskId` in the body | Cleaned or refused; every file lands under its uploader's folder in this task's folder |
| M5 | With a session URI: send more bytes than declared, keep uploading after Stop link, reuse it for a second file | Google refuses extra bytes; after-stop file flagged; reuse writes nothing new |
| M6 | Report "done" with another file's id, or with a short file | Ignored: the server reads the truth from Google |
| M7 | Call every public endpoint with another uploader's device key or made-up ids | Nothing about anyone else |
| M8 | Names and file names with `<script>`, `<img onerror>`, `javascript:`, `{{ }}`, very long text | Shown as plain text in the live view, sheet, History, in-app and push notifications, email fallback |
| M9 | Call the API from another origin, with and without a member's cookies | No CORS allowance; cookies ignored |
| M10 | Frame the page in an iframe | Blocked |
| M11 | Script 1,000 session opens, 100 names, a declared size larger than the free space, progress spam | Each limit in §4 C holds; one notice per rule |
| M12 | 50 new names on one link | At most 5 notices and one summary |
| M13 | As Crew, a freelancer and another Admin: call the live-view read and every member action | FORBIDDEN; no folder link in any response |
| M14 | Search every HTML, JS and JSON response for `ya29.`, `1//`, `client_secret`, the test account's address | None |
| M15 | Upload the EICAR test file, an `.html`, an `.svg` with script, an `.exe` renamed `.mp4.exe` | MaxOff serves none of them; chips shown (D3); Drive's own behaviour noted |
| M16 | Copy the device key to another browser | Sees only that uploader's own list (accepted risk) |
| M17 | Check the headers of `/upload` and `/api/upload/*` | Exactly as §4 J |
| M18 | Send a 5 MB JSON body, slow-drip requests | Refused at 64 KB; the Worker doesn't hang |
| M19 | Two devices with the same name; All files received during an upload; cancel the task mid-upload | As in §5, nothing lost, flagged correctly |
| M20 | Fill the test Drive to near full; disconnect the test account | Screens N and R; Owner notices once |

## 8. Done when
- E0 passed, or the Owner decided the CORS fallback.
- Every row of §4 has its proof green in `pnpm check` and the full CI run (both Playwright shards).
- §7.4 run on staging with results in the READY post; must-fix items fixed.
- PERMISSIONS, WORKFLOWS §9, DATA-MODEL and the new ADR merged before the code.
- The Owner has accepted, in writing on #89, the leftover risks: session URIs can't be revoked (A9, E5); a copied device key shows its own list (B3); large files aren't virus-scanned by anyone (D); a typed name isn't checked (B1).

## Pass 1 log

**19 Nov 2026, 00:41 UTC: CORS check, step 1 (no account needed).**
- A browser-style preflight (`OPTIONS https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`, `Origin: https://app.maxoff.in`, asking for `PUT` with `content-range, content-type`) answered **200**, with:
  - `access-control-allow-origin: https://app.maxoff.in`
  - `access-control-allow-methods: DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT`
  - `access-control-allow-headers: content-range,content-type`
- The same preflight against a made-up `upload_id` answered 404 with no CORS headers. That is expected for a session that doesn't exist, so it proves nothing either way.

**Still open, step 2 (needs a real session, so a Google account):**
1. The Worker opens a resumable session on the staging test Gmail.
2. A browser on the preview origin PUTs chunks to the session address.
3. Check that:
   - the 308 answers expose `Range`, so the page can resume;
   - the final 200/201 is readable;
   - a status query (`PUT` with `Content-Range: bytes */<total>`) works across origins.

This needs the owner's Google Cloud setup and a test Gmail connected on staging. It is the first thing to run once that exists. If step 2 fails, stop and tell the advisor before designing around it.

## 9. Conflicts and gaps found in the decisions

| # | Where | The conflict | Proposed way through |
|---|---|---|---|
| 1 | 6879244245 "expiring" vs 6879421505 "until the task is done" | The later spec wins: no time limit, so a long-open task keeps a live link for months | Accept; show the link's age on the card (A10); Stop link and the kill switch remain |
| 2 | 6879244245 "it can complete the task" vs 6879421505 "no auto-complete" and 6879555186 | Later decisions win: Done only via the coordinator, or a nudge to the Crew primary | As drawn |
| 3 | 6879421505 "coming back later shows what's done" vs 6879494745 "no listing" | Showing what's done is a listing to anyone with the link | Only the same device's own files (B3, B4) **[Q4]** |
| 4 | 6879421505 "stuck → Call / WhatsApp to the uploader" vs typed, unchecked names | MaxOff has no number for a non-member | **Decided (owner, 19 Nov):** no phone field and no Call/WhatsApp; the stuck alert names the uploader only |
| 5 | 6879421505 "anything, any size" vs the brief's "size and type caps" and ADR-0010's 25 / 100 MB caps | The decision has no caps | Safety limits only (§4 C), the space guard, and the risky-type chip **[Q13]** |
| 6 | ADR-0010 (R2 first, MaxOff names the files, `Photos|Videos` folders) vs 6879421505 (no R2 copy, Drive is the original, original names and folders kept under the uploader's name) | ADR-0010 must not be contradicted silently | **A new ADR** amending ADR-0010 for upload-link files; needs Owner approval (CLAUDE.md: stop and ask) |
| 7 | 6879421505 "the folder link when finished" vs a personal Gmail Drive | An Admin can't open the studio's folder unless it's shared with their Google address | **Decided (owner, 19 Nov):** no sharing per folder; the Admins already use the studio's Drive account, so the link just opens the folder |
| 8 | ARCHITECTURE §10a "nothing polls on a timer" vs "live view" | A live view needs updates | Polling exception while uploading, or Realtime (H5) |
| 9 | "Bytes never through MaxOff" vs the unverified browser CORS on Drive sessions (6879293330) | If CORS fails, bytes would need the Worker | E0 spike first; stop and ask if it fails |
| 10 | 6879421505 "warn if the Drive would run out" vs no studio numbers to strangers | A warning must not reveal the studio's storage | Wording without numbers; hold files that can't fit **[Q11]** |
| 11 | Google's ~750 GB/day upload limit on a personal account | Not mentioned in the decisions; a big shoot day can meet it | Pause and resume; tell the Owner and Admin **[Q10]** |
| 12 | "Storing only a hash" vs "Copy link" any time | A hash can't be shown again | HMAC-derived token (A3), or show once |
