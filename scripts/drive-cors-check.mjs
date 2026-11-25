#!/usr/bin/env node
// v4.5 security plan, CORS step 2 (E0): can a browser on MaxOff's own origin send a file straight
// to Google Drive through a resumable session the server opened, and read Google's answers?
// Run by the Preview workflow's dispatch-only `drive-cors-check` job against STAGING only, with
// the test Gmail the Owner connected there (never the studio account). Read-only on MaxOff's
// data; it makes one small test file in that Drive's "MaxOff" folder and deletes nothing.
//
// Environment (the staging GitHub environment): SUPABASE_URL, SUPABASE_SECRET_KEY (to read the
// sealed grant), DRIVE_TOKEN_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and ORIGIN
// (the page origin the browser runs on, e.g. the phase-v40 preview). Nothing secret is printed.
import { chromium } from "@playwright/test";

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const fromBase64Url = (text) => {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
};

/** The same format as src/core/drive/token-crypto.ts: v1.<iv>.<ciphertext>, AES-256-GCM. */
async function unseal(stored, base64Key) {
  const [version, iv, body] = stored.split(".");
  if (version !== "v1" || !iv || !body) throw new Error("Not a stored Drive token");
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv) },
    key,
    fromBase64Url(body),
  );
  return new TextDecoder().decode(plain);
}

const results = [];
const record = (step, ok, detail) => {
  results.push({ step, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} | ${step} | ${detail}\n`);
};

async function main() {
  const origin = new URL(env("ORIGIN")).origin;

  // 1. The connected account, read with the service key (staging only).
  const accountRes = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/drive_account?state=eq.connected&select=refresh_token_encrypted,root_folder_id`,
    {
      headers: {
        apikey: env("SUPABASE_SECRET_KEY"),
        authorization: `Bearer ${env("SUPABASE_SECRET_KEY")}`,
      },
    },
  );
  const accounts = await accountRes.json();
  if (!Array.isArray(accounts) || accounts.length !== 1 || !accounts[0].root_folder_id) {
    throw new Error("No single connected Drive account on staging: connect the test Gmail first.");
  }
  const refreshToken = await unseal(accounts[0].refresh_token_encrypted, env("DRIVE_TOKEN_KEY"));

  // 2. A fresh access token.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    }).toString(),
  });
  const token = await tokenRes.json();
  if (!token.access_token) throw new Error(`Google refused the refresh (${tokenRes.status})`);
  record("refresh", true, "access token obtained");

  // 3. A resumable session for a 3-chunk file, opened for the page's origin.
  const chunk = 256 * 1024;
  const size = chunk * 2 + 1000;
  const stamp = crypto.randomUUID().slice(0, 8);
  const sessionRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum,parents",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": "application/octet-stream",
        "x-upload-content-length": String(size),
        origin,
      },
      body: JSON.stringify({
        name: `maxoff-cors-check-${stamp}.bin`,
        parents: [accounts[0].root_folder_id],
        description: "MaxOff v4.5 CORS check (test file; safe to delete by hand).",
      }),
    },
  );
  const sessionUrl = sessionRes.headers.get("location");
  record("open session", Boolean(sessionUrl), `status ${sessionRes.status}`);
  if (!sessionUrl) throw new Error("Google gave no session address");

  // 4. The browser part: on the page's own origin, PUT the chunks and read Google's answers.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
    const browserResults = await page.evaluate(
      async ({ url, size, chunk }) => {
        const out = [];
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
        const put = async (start, end, label) => {
          try {
            const res = await fetch(url, {
              method: "PUT",
              headers: { "content-range": `bytes ${start}-${end - 1}/${size}` },
              body: bytes.slice(start, end),
            });
            out.push({
              label,
              status: res.status,
              range: res.headers.get("range"),
              body: res.status < 300 ? await res.text() : "",
            });
          } catch (error) {
            out.push({ label, error: String(error) });
          }
        };
        await put(0, chunk, "chunk 1");
        try {
          const res = await fetch(url, {
            method: "PUT",
            headers: { "content-range": `bytes */${size}` },
          });
          out.push({ label: "status query", status: res.status, range: res.headers.get("range") });
        } catch (error) {
          out.push({ label: "status query", error: String(error) });
        }
        await put(chunk, chunk * 2, "chunk 2");
        await put(chunk * 2, size, "chunk 3 (last)");
        return out;
      },
      { url: sessionUrl, size, chunk },
    );
    for (const r of browserResults) {
      if (r.error) {
        record(r.label, false, `browser refused: ${r.error}`);
      } else if (r.label === "chunk 3 (last)") {
        let id = null;
        try {
          id = JSON.parse(r.body).id ?? null;
        } catch {}
        record(
          r.label,
          (r.status === 200 || r.status === 201) && Boolean(id),
          `status ${r.status}, file id readable: ${Boolean(id)}`,
        );
      } else {
        // A 308 whose Range the page can read: the session's CORS exposes it.
        record(
          r.label,
          r.status === 308 && Boolean(r.range),
          `status ${r.status}, Range readable: ${r.range ?? "no"}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    record("run", false, error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    process.stdout.write(failed === 0 ? "CORS check: PASS\n" : `CORS check: FAIL (${failed})\n`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
