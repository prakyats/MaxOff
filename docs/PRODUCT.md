# MaxOff: Product Spec

> **What** MaxOff does. See `ARCHITECTURE.md` for **how** it's built.
> Owner: Pixora Clips · Last updated: 19 Sep 2026

---

## 1. Context

**Pixora Clips** is a business growth company for **founder-led businesses**. It delivers growth through content, social media and performance marketing, as one strategic partner instead of several disconnected agencies. It works in Mangalore now, with Bangalore next.

**Services** (these are *seed data*, editable in Settings → Lists → Services):
1. Growth Partnership (monthly retainer)
2. Performance Marketing (Meta and Google Ads)
3. Landing Page Development
4. CRM Setup & Automation
5. Strategy Session

**How Pixora usually works:** Understand → Analyze → Strategize → Execute → Measure → Optimize, starting with the Pixora Business Audit™.

> ⚠️ **Every client is different.** The framework above is Pixora's *usual* approach. It is **not** a rule the software enforces. MaxOff has to let each client have its own services, requirements, deliverables, workflow, fields and templates. What stays the same for every client is only the *kind* of information kept (identity, brand guidelines, requirements, monthly workflow, monthly deliverables). The *content* is always specific to that client.

## 2. Goals
1. One place for **everything about a client**: details, requirements, brand identity and assets, and what's delivered each month.
2. Run every engagement as a **project** using a workflow that suits that client, started from a template in seconds.
3. Everyone knows **what they have to do today**, and the owner can see **what's at risk**.
4. **Production quality** from day 1: secure, reliable, backed up and fast.
5. **Can be extended** at any time (leads, invoicing, content calendar...) without disrupting daily work.

## 3. Users and roles
Internal team only. Access is by invite, clients never log in, and nobody can sign up.

| Role | Summary |
|---|---|
| Owner | Everything, including company settings, roles and permanent deletes |
| Admin | Manages team, clients, templates, settings and all projects |
| Member | Sees clients and brand kits. Works on the projects they're a member of |

Permissions are stored as data (see ARCHITECTURE §4.5), so custom roles such as "Editor" or "Ads Specialist" can be added later without code changes.

---

## 4. Scope (MVP)

### 4.1 Team
- Invite a person by email with a role and job title. They can be re-invited, or the invite cancelled.
- Member list and member page (their projects, open tasks and workload).
- Change role; deactivate or reactivate. A deactivated person loses access immediately, and their history is kept.
- Profile: name, photo, job title, phone.
- The list of job titles is editable. Templates use it to assign tasks automatically.

### 4.2 Clients (CRM)
- **Client record:** name, legal name, logo (from the Brand Kit), industry, city, website, status (prospect / onboarding / active / paused / past), founder / decision-maker, email, phone, address, GSTIN, account manager, tags, notes, **requirements** (free text), and **custom fields**.
- **Services per client:** one or more services from the list, each with a scope note, start and end dates, and an active or ended state.
- **Contacts:** several per client, one marked as primary, with custom fields.
- **List:** switch between cards (logo, name, status, services, colour swatches) and a table. Search, filters (status, service, tag, city, account manager, custom fields), sorting, and filters kept in the URL.
- **Client page tabs:** Overview · Brand Kit · Deliverables · Projects · Contacts · Activity. Future modules can add tabs through extension slots.
- Archive and restore.

### 4.3 Brand Kit (for each client)
- **Logos and assets:** upload several files, each with a category (logo, icon, guideline, image, template, video, audio, other, and the list can be edited) and a variant (primary / secondary / light / dark / mono). Previews on light and dark backgrounds.
- **Colours:** name, HEX (RGB shown too), role, and order. Clicking one copies it.
- **Fonts:** family, usage, and source (Google Font preview, uploaded file, or link).
- **Identity text:** tagline, tone of voice, target audience, brand story, dos and don'ts, competitors, hashtags, and social handles.
- **Custom brand fields** for anything else, e.g. photography style, music style or caption style.
- Download a single file, or **the whole kit as a ZIP**. Video and audio play inline.
- A reusable **Brand panel** component used on project pages.

### 4.4 Deliverables (what each client gets, recurring)
- For each client: a list of deliverables. Each has a type (Reel, Static, Carousel, Story, Script, Ad creative, Landing page, Report... editable), a quantity, a frequency (monthly / weekly / one-off), a platform, specs or notes, active or paused, and custom fields.
- Example: *"Client A: 12 Reels/month on Instagram (9:16, max 45 s, Hindi + English captions), 8 Statics/month, 1 Performance report/month."*
- Templates can **turn deliverables into tasks** when a project is created (e.g. "Reel 1/12" ... "Reel 12/12").

### 4.5 Projects and tasks
- A project has: a client (optional), a template it came from (optional), name, description, lifecycle status (planned / active / on hold / completed / cancelled), period (start and end, e.g. "October 2026"), lead, members, and custom fields.
- **The workflow is set per project:** its own board **statuses** (each with a category todo / active / done) and optional **phases** with optional gates. All editable in project settings.
- **Tasks:** title, description, phase, status, priority, assignee, due date, subtasks, custom fields, a link to a deliverable (optional), attachments and comments.
- **Views:** Board (drag and drop, optionally grouped by phase), List (sort and filter), and Phases.
- **Brand panel** for the linked client in a side drawer.
- Progress is worked out from status categories. Overdue and at-risk projects are flagged.
- Client page → Projects tab. Archive and restore.

### 4.6 Templates
- **Global templates** (e.g. "Growth Partnership – monthly") and **client-specific templates** (e.g. "Client A – monthly workflow").
- A template has statuses, phases (optional, with gates), and tasks. Each task has a phase, description, priority, due offset (D+n from the start), and default assignee (a person or a job title). It also has a setting for whether to generate tasks from the client's active deliverables, and which phase to put them in.
- **Create a project from a template:** pick the client, template, start date or period, and lead, then **preview** and adjust before creating.
- **Save a project as a template.**
- **Recurring:** templates can be monthly or weekly. "Create next period" carries unfinished tasks over. The dashboard reminds you when the next period is due.
- **Loaded to start with** (examples, all editable, see §7): Pixora Business Audit™, Growth Partnership (monthly), Performance Marketing, Landing Page, CRM Setup, Strategy Session, and a blank "Simple Kanban".

### 4.7 Dashboard, notifications and search
- **Dashboard:** my tasks (overdue / today / this week), my projects, and items that need attention (overdue projects, retainers without next month's project, clients with no active project).
- **In-app notifications:** assigned to a task, mentioned in a comment, task due tomorrow, task overdue. Email notifications come later.
- **Global search** (Ctrl+K) across clients, projects, tasks and contacts.

### 4.8 Settings
Company profile (name, logo) · Team & roles · Job titles · **Lists** (services, deliverable types, asset categories, industries, platforms, tags) · **Custom fields** (for each entity, globally or for one client) · Templates · Feature flags (owner) · Storage use · Data export.

---

## 5. Out of scope for the MVP (planned, see ROADMAP "Later")
Leads & pipeline · Content calendar · Client approval of creatives · Time tracking · Quotes & invoices (GST) · Client KPIs (revenue, leads, CAC, margin, retention) · Business Audit™ scoring form · Social publishing · Email notifications · Client portal · Mobile app · AI features.

## 6. Quality requirements (what "production level" means here)
| Area | Requirement |
|---|---|
| Security | RLS on every table, invite-only access, deactivation takes effect immediately, private files through expiring links, SVGs sanitized, rate limits on auth, security headers |
| Reliability | Nightly backups with a tested restore, error monitoring, uptime monitoring, and CI that blocks merges when red |
| Data safety | Archive instead of delete, an activity log on every change, CSV export |
| Performance | Pages usable in under 2 s on 4G, lists paginated, database indexed |
| UX | Loading, empty, error and denied states everywhere; keyboard friendly; usable at 375px; accessible (WCAG AA contrast and labels) |
| Maintainability | Module boundaries enforced by lint, tests at every layer, docs and ADRs kept current |

## 7. Templates loaded at the start (examples, all editable)
Timings are D+n (days after the start date). Assignee = a default job title.

**Pixora Business Audit™ (~14 d, gates ON).** Phases: Understand · Analyze · Strategize · Deliver.
- Understand: Kick-off call with the founder (D+1) · Business questionnaire (D+2) · Collect access (D+3)
- Analyze: Review revenue, leads, margin, CAC, retention (D+6) · Channel review (D+7) · Funnel and sales review (D+7) · Competitor analysis (D+8)
- Strategize: Health Score (D+10) · Strengths and risks (D+10) · Priorities (D+11) · 90-day roadmap (D+12)
- Deliver: Present the audit (D+14)

**Growth Partnership: monthly (monthly, gates ON, generates tasks from deliverables into Execute).** Phases: Understand · Analyze · Strategize · Execute · Measure · Optimize.
- Monthly check-in (D+1) · Performance review (D+2) · Competitor analysis (D+3) · Content strategy (D+4) · Content calendar (D+5) · Scripts (D+7) · *[deliverable tasks]* · Posting and scheduling (D+13) · Community management (D+30) · Monthly report (D+28) · Strategy review (D+30)

**Performance Marketing (~30 d).** Goals and budget (D+1) · Ad account access (D+2) · Review past campaigns and competitors (D+4) · Campaign strategy (D+6) · Creative direction (D+7) · Ad copy (D+9) · Tracking setup (D+10) · Creatives (D+11) · Launch (D+13) · Weekly report and optimization (D+20, D+27)

**Landing Page (~21 d).** Brief (D+1) · Competitor pages (D+3) · Structure (D+4) · Wireframe (D+6) · Copy (D+8) · Design (D+11) · Build (D+16) · Mobile, SEO, analytics (D+18) · QA and launch (D+20) · Conversion check (D+34)

**CRM Setup (~21 d).** Map the current process (D+2) · Find gaps (D+4) · Pipeline design (D+6) · Workflow design (D+7) · Build (D+13) · Integrations (D+15) · Import data (D+16) · Team onboarding (D+19) · Check end to end (D+20) · 30-day review (D+50)

**Strategy Session (~10 d).** Questionnaire (D+1) · Audit, competitors, marketing review (D+5) · Opportunities (D+6) · Action plan, roadmap, fit recommendation (D+7) · Session (D+8) · Summary sent (D+10)

**Simple Kanban.** No phases, statuses To Do / In Progress / Review / Done, no tasks.

## 8. Open questions (for Pixora)
- [ ] Current team job titles.
- [ ] Review the loaded templates (§7) before phase 7.
- [ ] Brand fields to add as defaults (photography style, music, caption style, ad account IDs...).
- [ ] Should notifications also go to email or WhatsApp later?
