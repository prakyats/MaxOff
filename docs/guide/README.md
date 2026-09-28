# The app guide

`MaxOff-App-Guide.html` is the plain-language guide to the finished app: every role's flow as tap paths, who sees what, and what each phase delivers. It uses the example cast **Prishit** (Owner), **Prakyat** (Admin) and **Xyz** (Employee). `MaxOff-App-Guide.pdf` is the same file printed. Since 3c.3 it describes **stage 1 as live at `https://app.maxoff.in`**.

`first-day.html` ("Your first day with MaxOff") is the one page the Owner hands each new staff member with their invite (`docs/runbooks/go-live.md` step 7): installing the app from the invite link, Start day, End day, expenses, leave, what the Owner sees, and what to do when something goes wrong. Printed, `first-day.pdf` is **one tall, phone-width page** (110 × 720 mm), because it is read on a phone after arriving on WhatsApp. It speaks to staff, so it names **no phases, tasks or build words**.

- **The HTML is the source.** When a product decision changes a flow the guide describes (PRODUCT, WORKFLOWS, ROADMAP, an ADR), update the HTML in the same change, then rebuild the PDFs. Keep the "Ready now" / "Phase N" tags current as phases land, and the first-day page true to what staff see.
- **Hand-formatted:** both files are excluded from Prettier (`.prettierignore`), because the screen mock-ups depend on exact whitespace.
- **The PDFs are built on the laptop, with Edge** (Windows, no install needed; the pages use Segoe UI), and only these are committed: `powershell -NoProfile -ExecutionPolicy Bypass -File docs/guide/build-pdf.ps1` prints both HTML files to `MaxOff-App-Guide.pdf` and `first-day.pdf` next to them. **After the phase 3c merge the committed guide PDF is behind its HTML and `first-day.pdf` does not exist yet:** the Owner runs the script on the laptop and commits both (a step of `docs/runbooks/go-live.md`). Check that `first-day.pdf` is a single page; if Edge ever puts it on two, raise the `@page` height in `first-day.html`.
- **A cloud session has no Edge.** Playwright's cached Chromium can print a page to preview its layout (the fonts fall back from Segoe UI to the container's sans-serif, so pages break differently): never commit a PDF printed that way.
  ```bash
  /opt/pw-browsers/chromium-1243/chrome-linux64/chrome --headless=new --disable-gpu --no-sandbox \
    --no-pdf-header-footer --print-to-pdf=/tmp/preview.pdf "file://$PWD/docs/guide/first-day.html"
  ```
