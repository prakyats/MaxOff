# The app guide

`MaxOff-App-Guide.html` is the plain-language guide to the finished app: every role's flow as tap paths, who sees what, and what each phase delivers. It uses the example cast **Prishit** (Owner), **Prakyat** (Admin) and **Xyz** (Employee). `MaxOff-App-Guide.pdf` is the same file printed.

- **The HTML is the source.** When a product decision changes a flow the guide describes (PRODUCT, WORKFLOWS, ROADMAP, an ADR), update the HTML in the same change, then rebuild the PDF. Keep the "Ready now" / "Phase N" tags current as phases land.
- **Hand-formatted:** it is excluded from Prettier (`.prettierignore`), because the screen mock-ups depend on exact whitespace.
- **Rebuild the PDF** (Windows, Microsoft Edge, no install needed): `powershell -NoProfile -ExecutionPolicy Bypass -File docs/guide/build-pdf.ps1`
