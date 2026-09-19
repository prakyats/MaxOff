# Kyran.ai: Software Analysis

> **Researched:** 19 September 2026
> **Sources:** kyran.ai (public pages, sitemap, and text pulled from the site's code), its FAQ, terms and policies, and public listings on Google Workspace Marketplace, LinkedIn and Instagram.
> **Note:** This is based on what Kyran publishes about itself. The app was **not** signed up for or tested.

---

## 1. Overview

| Item | Detail |
|---|---|
| Product | Kyran.ai, an "All-in-One Business Workspace" |
| Tagline | "One workspace. One subscription. Replace 25+ tools instantly." |
| Positioning | Replaces Hootsuite, HubSpot, QuickBooks and Monday.com |
| Also compared against (on its blog) | Zoho One, Odoo, Bitrix24, ClickUp, Apptivo, Buffer, Sprout Social, Later, Salesforce, Mailchimp |
| Target users | Startups, small businesses, agencies, solopreneurs, growing teams (mainly in India) |
| Stage | **Beta** ("Kyran.ai Beta is Live 🚀 Onboarding Started") |
| Owner | RORE DIGITAL MEDIA ENTERTAINMENT PRIVATE LIMITED |
| Registered address | 21/330/2, G N 47, Near Dr. Changundi, Ketkale Nagar, Ichalkaranji, Kolhapur, Maharashtra, India, 416115 |
| Legal disputes | Arbitration in Kolhapur, Maharashtra |
| Support | support@kyran.ai |
| Social | [LinkedIn](https://www.linkedin.com/company/kyran-ai/) · [Instagram @kyran.ai](https://www.instagram.com/kyran.ai/) · Facebook page |
| Related product | "Kyran AI App Builder for Sheets™", a Google Sheets add-on for building no-code mini-apps |
| Uptime target | 99.9%, not counting planned maintenance |
| Best used on | Desktop or laptop (the app reminds mobile users to log in from a computer) |

---

## 2. How the software is built

Based on the site's code:

- **Front end:** React single-page app, built with **Lovable** (an AI app builder; shows as `gptengineer.js` and `/lovable-uploads/` in the code). Styled with Tailwind CSS, animated with Framer Motion.
- **Back end:** a hosted Postgres database with built-in login, most likely **Supabase** (the code calls stored database functions).
- **Text editor:** ProseMirror/TipTap. **PDF generation:** pdf-lib, used for invoices and LinkedIn PDF carousels.
- **Outside services it connects to:** Meta Graph API v24 (Facebook and Instagram), LinkedIn API, X and YouTube (listed as coming soon), Google Sheets, webhooks (Zapier, Make, n8n), email sending and receiving, and a payment gateway.
- **Marketing site:** the landing, about, brand, FAQ, learn and blog pages live in the same app. The blog is mostly "Kyran vs competitor" articles written for search engines.

---

## 3. Modules and features

The workspace has five main areas, plus Offerings, Mail, Calendar and Storage.

### 3.1 Marketing (`/marketing`)
- **Social posting:** create, schedule, publish and delete posts on **LinkedIn** (personal profile or company page), **Facebook Pages** and **Instagram**. Supports image and carousel posts (carousels need at least 2 images), and one post can go to 3 platforms at once.
- **AI content:** "Generate an entire month of social posts in minutes." Posts match your brand voice, and the tool suggests the best time to post.
- **Scheduling:** queue, drafts, cancel scheduled posts, and time-zone support.
- **Shared social inbox (`/marketing/inbox`):** read, moderate and reply to comments and DMs from Facebook, Instagram and LinkedIn in one place.
- **Analytics (`/marketing/analytics`):** followers, engagement, page and profile insights, and campaign performance reports.
- **Media library (`/marketing/media`):** stores and organizes images and videos for posts.
- **Lead forms (`/marketing/leadforms`):** embeddable forms with custom questions (required or optional). Answers flow into the CRM.
- **SyncLead (`/marketing/SyncLead`):** pulls leads from Google Sheets or from any outside system by webhook (Zapier, Make, n8n). Leads are tagged with their source sheet and can be sent to a specific team member.
- **Coming soon:** automatically adding your company logo to posts.

### 3.2 Sales / CRM (`/crm`)
- **Leads:** status tracking (New, Contacted, Qualified, and so on), notes, and assignment to team members.
- **Automatic lead assignment:** rotates leads among chosen team members, or gives each new lead to whoever has the fewest open leads.
- **Lead pool:** leads can be claimed and released. "Claim Free Business Leads" offers ready-made lead packs.
- **Contacts and companies:** linked records, where edits update everywhere, and deleting one can remove linked records across the CRM.
- **Deals and pipeline (`/crm/pipeline`):** drag-and-drop board of stages with deal values, close dates and win chances. Marking a lead as "won" creates a deal, and a deal can **automatically create a project** with team members assigned.
- **Follow-ups (`/crm/follow-up`):** follow-up dates and notes, collected in one list.
- **Groups (`/crm/groups`):** custom groups that apply to leads, contacts and companies across the organization.
- **Import and export:** CSV import (limited on the free plan) and data export.
- **Permissions:** separate rights to create/edit and to delete CRM records.

### 3.3 Finance (`/finance`)
- **Dashboard:** cash position, money owed to you and by you, expense overview and revenue charts.
- **Quotes:** line items, pricing and terms. Shared by public link (`/quotelink/:slug`), locked once accepted, and converted to an invoice in one click.
- **Invoices:** professional PDF invoices with **GST support**:
  - Seller GSTIN (15-character check), place of supply, IGST, and export invoices under LUT or with IGST paid.
  - Discounts, taxes, deductions and notes.
  - Shared by public link (`/invoicelink/:slug`).
  - **Recurring invoices** that create drafts each billing cycle, and can be paused or resumed.
- **Payments:** records payments and handles deductions such as TDS (gross vs net amount).
- **Credit notes:** adjust invoices and stock.
- **Customers:** billing records linked to CRM contacts.
- **Vendors, bills and purchase orders:** vendor records with full transaction history. POs are shared by link (`/po-link/:slug`) and converted into bills.
- **Expenses:**
  - One-off and recurring expenses (rent, subscriptions, utilities), with categories and receipts.
  - Recoverable input GST/VAT.
  - Approval steps (submit → approve or reject), expense policies, reimbursement of personal expenses, and reversals and refunds.
  - Expenses linked to projects, with forecasts and 6-month projections.
- **Budgets:** budget allocation per department.

### 3.4 Offerings (`/offerings`)
- **Products:** SKU, pricing, stock tracking, stock movement history, reorder alerts and inventory value by category.
- **Services:** hourly or fixed pricing, with delivery timelines.
- **Courses:** curriculum, pricing, duration, schedule and seat capacity.
- **Subscriptions:** plans billed monthly, quarterly or yearly, with MRR/ARR tracking.
- **Bundles:** combine items at special pricing, for upsells.
- **Reports:** inventory, rates, ARR and bundles.

### 3.5 Projects (`/projects`)
- **Project list:** name, description, start and end dates, budget, and duplicate project.
- **Project Head role:** each project has a head who can manage its tasks, members and expenses.
- **Tasks:** Kanban board (To Do → In Progress → Review → Completed) with priorities, due dates and assignees.
- **Timeline:** milestones and task dependencies.
- **Workload:** shows how tasks are spread across the team.
- **Time tracking:** shared timers and logged hours for billing (only the organization owner can see time tracking).
- **Health and budget:** status of on track, at risk, or overdue / over budget, with warnings when spending is on course to exceed the budget.
- **Task visibility levels:** see only your own tasks, tasks in your projects, or all tasks in the organization.

### 3.6 Team / HR (`/team`)
- **Members and departments,** with department-based access to each module.
- **Attendance:** check-in and check-out, work hours, and records the owner can edit.
- **Leave:** requests with reasons, approved or rejected by the owner, with filters.
- **Performance:** personal metrics and task completion rates.
- **Team chat (`/team/chat`):** direct messages, group chats and automatic project chats, with file sharing.

### 3.7 Mail (`/mails`)
- A full email client: inbox, sent, drafts, scheduled, snoozed, starred, archive and trash.
- Email templates, labels, send later and snooze.
- Email analytics: volume over time and most frequent senders.
- Domain verification setup (SPF, DKIM, DMARC) for better delivery.

### 3.8 Other parts of the app
- **Calendar (`/calendar`)**
- **Storage (`/storage`):** storage limit for each workspace, used by chat files and social media uploads.
- **Learn and Manual (`/learn`, `/manual`):** video tutorials and step-by-step guides for owners and team members.
- **Bonus Picks (`/bonuspicks`):** free tools, templates, credits and lead packs.
- **Industry landing page:** coworking spaces (`/landingCoworkingSpace`).
- **Account deletion (`/erase-data`):** instant, permanent deletion of all data and social connections.

---

## 4. Roles and permissions

| Role | Access |
|---|---|
| Organization Owner | Everything: billing, time tracking, approvals, changing the Project Head, attendance |
| Project Head | Manages the projects assigned to them: tasks, members and expenses |
| Department Member | Modules allowed for their department. Sees only assigned leads and tasks, depending on settings |

---

## 5. Pricing

| Plan | Price | Limits |
|---|---|---|
| **Free** | ₹0 | 1 user (the owner), 2 projects, 2 invoices, 3 lead claims, 30 import rows, 10 MB storage |
| **Paid (beta offer)** | **₹5,900/month for 5 users** (≈ ₹1,180 per user per month incl. 18% GST) | Billed monthly, cancel anytime. Project limits of 1,000, 10,000 or 100,000 appear for different plan levels |
| **Custom Subscription** | Priced per seat | Unlimited seats and projects, no import limits, more storage per seat |

- The code has thank-you pages for **Solopreneur, Startup, Enterprise and Custom** plans, which suggests these are the plan levels.
- Extra seats can be bought and activate instantly.
- Coupons and discounts are supported.
- **Refund policy:** **no refunds**. Cancelling switches you to the Free plan immediately, and there's no pro-rata refund.

---

## 6. Kyran.ai Funds (`/get-funded`)
- Invests up to **₹15 lakh** of marketing-focused capital for **7.5% equity**.
- For early-stage, product-ready AI startups (products built on top of existing AI models).
- **₹499** fee to apply. Replies within 7 business days, and shortlisted founders get an introduction meeting.

---

## 7. Public website pages

| Page | URL |
|---|---|
| Home | `/` |
| About | `/about` |
| Brand / press kit | `/brand` |
| FAQ | `/faqs` |
| Contact / Support | `/contact`, `/support` |
| Learn / Manual | `/learn`, `/manual` |
| Onboard / sign up | `/OnboardNow`, `/auth` |
| Custom plans | `/CustomSubscriptions` |
| Bonus picks | `/bonuspicks` |
| Get funded | `/get-funded` |
| Legal | `/terms`, `/privacy`, `/refunds`, `/shipping`, `/erase-data` |
| Blog | `/blog/...` (about 30 comparison articles, e.g. Kyran vs Zoho, Odoo, Bitrix24, Monday.com, ClickUp, Apptivo) |

---

## 8. Main FAQ answers (from the site)
- **Technical skills needed?** No. It's beginner-friendly, with setup "in under 2 minutes".
- **Social platforms?** LinkedIn, Facebook and Instagram, with more coming.
- **Time zones?** Yes, posts follow the time zone set in your profile.
- **Security?** "Industry-standard encryption and OAuth". Passwords to your social accounts are not stored.
- **Account deletion?** Permanent and immediate, including social media access tokens.

---

## 9. Strengths and weaknesses

**Strengths**
- Genuinely broad: CRM, finance, projects, HR, social media, email and inventory in one place.
- Built for India: GST invoices, TDS-style deductions and pricing in rupees.
- Modules are connected: lead → deal → project → invoice.
- Cheap compared with paying for 4–5 separate tools.

**Weaknesses and risks**
- Still in beta, and built quickly with an AI app builder, so it may not be very reliable or polished yet.
- **No refunds** on paid plans.
- The free plan is very limited (2 invoices, 10 MB storage), which makes it hard to properly evaluate.
- X and YouTube are not live yet, and the logo-on-posts feature is still pending.
- Almost all comparison content is written by Kyran itself. There are few independent reviews.
- Mainly for desktop use.

---

## 10. Lessons for building a similar product
1. The same technology (React + Supabase + an AI API) is enough for a first version.
2. The hard parts are getting approval for the **Meta and LinkedIn APIs**, getting **GST invoicing** exactly right, **keeping each company's data separate**, and **email delivery**.
3. The most valuable part is the **connections between modules** (lead → deal → project → invoice), not any single module.
4. Search-engine traffic comes from "X alternative" and "X vs Y" articles.
5. Price per team (₹5,900 for 5 users) rather than per module.
