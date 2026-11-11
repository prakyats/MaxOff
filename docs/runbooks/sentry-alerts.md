# Runbook: Sentry alert rules (Owner, in the dashboard)

Gap audit 2 and 3 (`docs/reviews/6b20b-gap-audit.md`): MaxOff reports errors to Sentry (project `maxoff`,
environments `staging` and `production`; README "Confirming the Sentry pipeline"), but no alert rule is
written down. A session cannot create dashboard rules, so the **Owner** creates the three below, once.

**_(Unverified)_:** the menu and field names follow Sentry's issue-alert editor as it is generally laid
out. They have not been checked against this account from the repository. If a name differs, pick the
nearest match and correct this file. Issue alerts are available on Sentry's free (Developer) plan
_(unverified: check in the dashboard)_.

All three rules: **project `maxoff`**, **environment `production`** (staging errors are expected during
testing and should not wake anyone), and the action **send a notification to the Owner's email**.

## Before you start

1. Sign in at sentry.io → the organisation → **Settings → Account → Notifications**: email
   notifications for **Issue alerts** are on.
2. **Settings → Projects → maxoff → Security & Privacy**: "Prevent Storing of IP Addresses" is still on
   (README, ARCHITECTURE §18.2). The alerts do not change it.

## Rule 1: a new issue

The first time an error of a new kind happens on production.

1. **Alerts** (left menu) → **Create Alert**.
2. Choose **Issues** (an issue alert), then **Set Conditions**.
3. **Environment:** `production`. **Project:** `maxoff`.
4. **WHEN** (trigger): **"A new issue is created"**.
5. **IF** (filter): none.
6. **THEN** (action): **"Send a notification to Member"** → the Owner (or "Issue Owners", falling back to
   the Owner).
7. **Action interval:** **5 minutes** (so a burst of new issues sends one email per issue).
8. **Name:** `MaxOff production: new issue`. **Save Rule**.

## Rule 2: more than 10 events in an hour

One error repeating: something is broken for several people.

1. **Alerts** → **Create Alert** → **Issues** → **Set Conditions**.
2. **Environment:** `production`. **Project:** `maxoff`.
3. **WHEN:** **"The issue is seen more than {value} times in {interval}"** → value **10**, interval **one
   hour**.
4. **IF:** none.
5. **THEN:** **Send a notification to Member** → the Owner.
6. **Action interval:** **1 hour** (one email per issue per hour while it keeps happening).
7. **Name:** `MaxOff production: >10 events in 1h`. **Save Rule**.

This counts events **per issue**. A count across all issues together is a **metric alert** ("Number of
errors"), which may need a paid plan _(unverified)_; the per-issue rule covers the usual case of one
thing breaking.

## Rule 3: a regression

An issue that was marked resolved comes back (often after a release).

1. **Alerts** → **Create Alert** → **Issues** → **Set Conditions**.
2. **Environment:** `production`. **Project:** `maxoff`.
3. **WHEN:** **"The issue changes state from resolved to unresolved"** (Sentry also offers "The issue
   changes state from archived to escalating"; add it to the same rule if it is listed).
4. **IF:** none.
5. **THEN:** **Send a notification to Member** → the Owner.
6. **Action interval:** **5 minutes**.
7. **Name:** `MaxOff production: regression`. **Save Rule**.

Regressions only work if issues are **resolved** when fixed: resolve them "in the next release" in
Sentry when the fix ships, so a return is caught.

## Prove it

1. Open `https://maxoff-staging.<subdomain>.workers.dev/diagnostics/sentry` and send a test error
   (README "Confirming the Sentry pipeline"). It lands in `staging`, so **no** email should come: the
   environment filter works.
2. To prove the email itself: in one rule, **Send Test Notification** (on the rule's edit page)
   _(unverified)_. Never raise an error on production to test.
3. Write the date in the table below.

## When an alert arrives

`incident.md` → "Errors spiking (Sentry)".

## Rules created

| Date | Rule | By |
|---|---|---|
| | | |
