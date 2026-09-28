# The app guide

`MaxOff-App-Guide.html` is the plain-language guide to the finished app: every role's flow as tap paths, who sees what, and what each phase delivers. It uses the example cast **Prishit** (Owner), **Prakyat** (Admin) and **Xyz** (Employee). `MaxOff-App-Guide.pdf` is the same file printed. Since 3c.3 it describes **stage 1 as live at `https://app.maxoff.in`**.

`first-day.html` ("Your first day with MaxOff") is the one page the Owner hands each new staff member with their invite (`docs/runbooks/go-live.md` step 7): installing the app from the invite link, Start day, End day, expenses, leave, what the Owner sees, and what to do when something goes wrong. `first-day.pdf` is the same file printed as **one tall, phone-width page** (110 × 720 mm), because it is read on a phone after arriving on WhatsApp. It speaks to staff, so it names **no phases, tasks or build words**.

- **The HTML is the source.** When a product decision changes a flow the guide describes (PRODUCT, WORKFLOWS, ROADMAP, an ADR), update the HTML in the same change, then rebuild the PDF. Keep the "Ready now" / "Phase N" tags current as phases land, and the first-day page true to what staff see.
- **Hand-formatted:** both files are excluded from Prettier (`.prettierignore`), because the screen mock-ups depend on exact whitespace.
- **Rebuild the PDFs** (Windows, Microsoft Edge, no install needed; the pages use Segoe UI): `powershell -NoProfile -ExecutionPolicy Bypass -File docs/guide/build-pdf.ps1` prints both.
- **In a cloud session** (Linux, no Edge), Playwright's cached Chromium prints them the same way, with the container's sans-serif in place of Segoe UI (so the guide runs to a page or two more; rebuild on the laptop for the Windows fonts):
  ```bash
  CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome   # the folder follows the pinned @playwright/test
  for f in MaxOff-App-Guide first-day; do
    "$CHROME" --headless=new --disable-gpu --no-sandbox --no-pdf-header-footer \
      --print-to-pdf="$PWD/docs/guide/$f.pdf" "file://$PWD/docs/guide/$f.html"
  done
  ```
  Run it from the repository root. The first-day page must stay **one** page: after a change, check that the PDF's page count is 1 (`grep -ao "/Count [0-9]*" docs/guide/first-day.pdf`), and raise the `@page` height in `first-day.html` if it is not.
