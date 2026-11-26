READY FOR OWNER: v4.5 "Upload link" (`phase-v45` @ HEAD_SHA)

**What it is.** On a task's Work view, the Owner and the task's Admins get an **Uploads card**:
- **Get upload link**, then **Copy link** to send to a freelancer or camera operator.
- They open it on a phone or laptop, type their name, and send files straight into the task's folder in the studio's Google Drive. There is no login, and the files never pass through MaxOff.
- The card shows who is sending and how far they have got. Each uploader has a sheet with their files, including "Removed in Drive".
- **All files received** stops the link. On the Owner's own task it also completes the task; otherwise the task's primary owner is told "mark it done".

**What the Crew will notice:** nothing on their own screens. A Crew primary owner gets one new notice: "Files received for ‹task›: mark it done".

## Proof
- **Full CI:** FULL_CI_RUN on HEAD_SHA, green. That covers unit, pgTAP and all four Playwright shards, including the serial chain with the upload flows against a fake Google at 1280, 375 and 430.
- **The real round trip on staging** with the test Gmail: PASS. The page's MD5 equals Drive's.
- **The §7.4 pen test on staging** (`upload-pentest` job), run 2 = 45733118056: **PASS**, with 67 PASS, 0 FAIL, 6 NOTE and 6 MANUAL. Run 1 found two real issues, both fixed:
  - a NUL in a name answered 500; it is now refused;
  - `/upload` carried two CSPs on the Worker; it now carries one.
  Rows for your walk are below.
- **Release review** (`docs/reviews/v4.5/release-review.md`): architecture plus the design passes. 3 must-fix and 6 should-fix, all fixed with tests. Impeccable isn't available in this environment.
- **Speed gate** (every route, every role, plus /login and /offline), paired with the main preview, two-run rule:

| Role | Preview runs | Result |
|---|---|---|
| Owner | 45705822651, 45707609851 | Run 1: 4 last-byte FAILs. Run 2: PASS. Nothing slow twice. |
| Admin | 45709960724, 45712130629, 45714413849 | /clients was slow in runs 1 and 2; run 3 PASS. |
| Crew | 45715543490, 45716830319, 45718181336 | /me was slow in runs 1 and 2; run 3 PASS. |
| Local same-machine A/B (main vs v4.5, 150 ms per call, 10 samples) | | Every route for every role within ±6 ms, with identical reads (2,693 / 1,310 / 2,093). |
| /offline (local, not in the probe) | | 3.9 vs 3.8 ms |
| First-load JS | | /today −14.1 KB (the sonner patch); /upload 582 KB, under its 612 KB budget; no budget raised. |

  The probe ran on 05eff5f4. Since then: a header-config split, a 404 catch-all route, and CSS and wording on the upload screens. None adds a read or changes a shared layout's reads. I can re-probe `/tasks/[id]` for each role if you want the slot spent.
- **Guide:** "How MaxOff works" covers the Owner's and Admins' upload topics. The pictures were re-taken today (GUIDE_SHOTS).

## Owner's walk (phone, then laptop; staging, test Gmail)
1. On a task you created, open Work, tap **Get upload link**, then **Copy link**. Paste it into WhatsApp to yourself **(pen test M2)**: the preview must not show a token.
2. Open the link on your phone in a private tab. Type a name and send 2–3 photos and one video. Lock the screen mid-way, then unlock: it continues.
3. On the laptop, open the same link. Send a folder (drag and drop). Tap **I'm done**.
4. Back on the task, check:
   - the card shows both uploaders;
   - each sheet lists the files, with "Check before opening" on any `.exe`, `.html` or `.svg`;
   - a name typed by an outsider shows as plain text.
5. In the test Drive, bin one received file and delete another for good **(M21)**. Reopen that uploader's sheet: both show "Removed in Drive".
6. **All files received**, both paths:
   - on your own task, it completes the task;
   - on a task with a Crew primary owner, the button is neutral and that person gets "mark it done".
7. The toasts are unchanged.
8. **(M15)** In the test Drive, look at how Google shows `eicar.com`, `page.html` and `picture.svg` from the pen test's task.
9. **(M8)** One upload push, and its email if push is off: the uploader's name reads as plain text.
10. **(M20)** Disconnect the test Gmail in Settings → Google Drive, then open a live link: "can't take files right now". Reconnect.
11. **(M2)** In Cloudflare's Worker logs and Sentry for the pen test's minutes (around PENTEST_TIME UTC), search for "upload" and confirm no token or address appears.
12. Two chip wordings to decide: "Not on this task · new name" in one chip, and "Link active" in blue.

## For you to accept in writing here (leftover risks, plan §8)
- **A9 / E5:** an upload session Google has already handed to a browser can't be revoked. A file that finishes after Stop is kept and flagged "arrived after the link stopped".
- **B3:** a device key copied to another browser shows that uploader's own list, and nothing else.
- **D:** large files aren't virus-scanned by anyone. MaxOff only flags risky types, and Drive scans what it can.
- **B1:** a typed name isn't checked; it is shown as typed and marked "not checked".
- **S7:** the space guard lets an uploader learn, coarsely (in 10 GB steps), whether the Drive has room. **Staging uses a test override of S7** (1 GB steps, no reserve), so a free test Gmail can take uploads. Production ignores the override.

## Your dashboard step
- The Cloudflare **WAF rate-limit rule on `/api/upload/*`**: `docs/runbooks/cloudflare-rate-limit.md`, "A second rule: the upload link's API". The numbers are a proposal.
  - On the Free plan, keep the one sign-in rule; the app's own limits (proved by M1) protect the upload API.

## Open, for the advisor
- Plan J says `scripts/smoke-deploy.sh` gains `/upload` checks. It has none yet, and the script is part of the production pipeline, so it is your call. I can add it.
- J5 (`X-Robots-Tag: noindex, nofollow` on `/upload`) can only be seen on staging's own address after the merge, because the preview edge overrides it.
- PROGRESS tech debt: `spaceGuard(process.env)` reads the app env at runtime.
