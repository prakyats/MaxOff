#!/usr/bin/env node
/**
 * Creates the first Owner account (PRODUCT §3, task 1.2). Run once per environment:
 *
 *   pnpm bootstrap:owner -- --email owner@example.com --name "Full Name" [--org "Company"]
 *
 * Anything not given as a flag is asked for on the terminal (email, full name, and the
 * organization name in case none exists yet). Nobody's name is hard-coded anywhere.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_APP_URL from
 * `.env.local` (`node --env-file`); for staging or production, point `--env-file` at a file
 * holding that project's values, or export the three variables in the shell.
 *
 * No password anywhere: the auth user is created without one, `bootstrap_owner()` (service
 * role only) inserts the active Owner member, and a one-time recovery link is printed. Opening
 * it is where the Owner chooses their password. Nothing is emailed, so this works before any
 * SMTP or sending domain exists. If the member insert fails, the auth user just created is
 * removed again so a re-run starts clean.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

/** Stops the run with a message and exit code 1, letting open connections close first. */
class BootstrapError extends Error {}

function fail(message) {
  throw new BootstrapError(message);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is not set. Run with \`node --env-file=.env.local\` or export it.`);
  return value;
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    org: { type: "string" },
  },
});

/** Asks on the terminal for a value that was not passed as a flag (empty when not a TTY). */
async function ask(question) {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const email = (values.email?.trim() || (await ask("Owner's email: "))).toLowerCase();
  const fullName = values.name?.trim() || (await ask("Owner's full name: "));
  const orgName =
    values.org?.trim() ||
    (await ask("Organization name (Enter to skip when one already exists): ")) ||
    null;
  if (!email || !email.includes("@")) fail("an email is required (--email).");
  if (!fullName) fail("the Owner's full name is required (--name).");

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");
  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");

  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 1. The auth user, without a password. Reuse one that already exists with this email so an
  //    interrupted run can be repeated.
  let userId;
  let createdHere = false;
  {
    const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
    if (error && error.code !== "email_exists")
      fail(`could not create the auth user (${error.code ?? error.status}).`);
    if (data?.user) {
      userId = data.user.id;
      createdHere = true;
    } else {
      const { data: page, error: listError } = await supabase.auth.admin.listUsers({
        perPage: 1000,
      });
      if (listError) fail("could not look up the existing auth user.");
      userId = page.users.find((user) => user.email?.toLowerCase() === email)?.id;
      if (!userId) fail("an auth user with this email exists but could not be found.");
    }
  }

  // 2. The organization (if none) and the active Owner member, in one transaction.
  {
    const { error } = await supabase.rpc("bootstrap_owner", {
      user_id: userId,
      email,
      full_name: fullName,
      org_name: orgName,
    });
    if (error) {
      if (createdHere) await supabase.auth.admin.deleteUser(userId);
      const reason =
        error.message === "CONFLICT" ||
        error.message === "VALIDATION" ||
        error.message === "NOT_FOUND"
          ? `${error.message}: ${error.details ?? ""}`.trim()
          : "the database refused the bootstrap.";
      fail(reason);
    }
  }

  // 3. The one-time link. The token is only ever shown here, once.
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (linkError || !link.properties?.hashed_token) {
    fail(
      'the Owner member exists, but no recovery link could be made. Use "Forgot your password?" on /login instead.',
    );
  }

  const confirmUrl = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`;

  process.stdout.write(
    [
      "",
      `Owner created: ${fullName} <${email}>`,
      "",
      "Open this link once to set the password (it expires in an hour):",
      "",
      `  ${confirmUrl}`,
      "",
      'If it has expired, use "Forgot your password?" on the sign-in page.',
      "",
    ].join("\n"),
  );
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(
    error instanceof BootstrapError
      ? `bootstrap-owner: ${error.message}`
      : "bootstrap-owner: unexpected failure.",
  );
  if (!(error instanceof BootstrapError)) console.error(error);
}
