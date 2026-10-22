import { ChevronRightIcon, PartyPopperIcon } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import Link from "next/link";

import { checkThenRead } from "@/core/lib/start-early";
import { LogoutButton } from "@/core/auth/components/logout-button";
import { requireMember, withSessionUserId } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { EditableRecord } from "@/core/ui/composites/editable-record";
import { PageHeader } from "@/core/ui/composites/page-header";
import { DeviceList, OnboardingSteps } from "@/core/notifications/components/me-lazy";
import { PushDeviceRow } from "@/core/notifications/components/push-device-row";
import { PushTestRow } from "@/core/notifications/components/push-test-row";
import { readPushEnv } from "@/core/notifications/env";
import { readOwnOnboarding } from "@/core/notifications/onboarding";
import { isIOS } from "@/core/notifications/push/browser";
import { deviceRowsOf } from "@/core/notifications/push/device-list";
import { listOwnPushSubscriptions } from "@/core/notifications/push/subscriptions";
import { fileUrl } from "@/core/storage";
import { Avatar, AvatarFallback, AvatarImage } from "@/core/ui/primitives/avatar";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { ReloadAppButton } from "@/core/ui/shell/reload-app-button";
import { initialsOf } from "@/core/ui/shell/viewer";
import { ThemeLabel } from "@/core/ui/theme/theme-label";
import { ThemeToggle } from "@/core/ui/theme/theme-toggle";
import { formatIST, systemClock } from "@/core/time";
import { displayName } from "@/core/lib/display-name";
import { ROLE_LABELS } from "@/core/lib/role-labels";
import {
  getOwnMember,
  listDirectoryOf,
  listOwnFreelancers,
  NAME_MAX_LENGTH,
  type OwnFreelancer,
  PHONE_MAX_LENGTH,
  type TeamMember,
  updateOwnProfile,
} from "@/modules/team";
import { AvatarEditor } from "@/modules/team/components/avatar-editor";

import { ME_DESCRIPTION } from "./copy";

export const metadata: Metadata = { title: "Me" };

/**
 * Me (PRODUCT §4.7), in the order of the V5b Me restructure (owner, SCOPE §3), for every role:
 * 1. **who you are**, one block: the photo (a ring, the initials without one), the name, the role
 *    and the sign-in email, Edit profile (the edit pattern, `EditableRecord`, task 2.9: read-only
 *    first; the name shows in the block, the phone under it) and the photo (`AvatarEditor`, 3.3);
 * 2. **My work** (whoever marks attendance, Admins and Crew): Attendance & leave, Extra work &
 *    expenses (5B decisions 3 and 7);
 * 3. **Your freelancers** (ADR-0013, an Admin who coordinates one);
 * 4. **Notifications**: this device ("Turn on here", 5.2), **Your devices** each with Remove
 *    (5.5, decision 5; red only in its confirmation), **Send a test notification**;
 * 5. **Appearance**: Light / Dark / System;
 * 6. **Help**: How MaxOff works (6b.14), Reload app;
 * 7. **Sign out of this device**, last (kickoff 3b decision 1: it lives here only): a red
 *    outline, never solid, since nothing is destroyed, with its confirmation;
 * 8. the **version**, small and muted, at the very bottom.
 *
 * An accepted invite lands here with `?welcome=1` (WORKFLOWS §1a) to check the name and add a
 * phone, and, for a member who joined after 5.5 shipped, the walkthrough that gets notifications
 * working (owner decisions 2026-10-03, 3 and 4); their every sign-in lands here again until they
 * finish it or tap Later (owner 2026-10-06).
 */
export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The profile row and the freelancers the member looks after (ADR-0013, 4C) start with the
  // session read, not after it (ARCHITECTURE §19).
  const [viewer, [{ welcome }, own, spells, subscriptions]] = await checkThenRead(
    requireMember(),
    Promise.all([
      searchParams,
      withSessionUserId(getOwnMember),
      listOwnFreelancers(),
      listOwnPushSubscriptions(),
    ]),
  );
  const push = readPushEnv();
  const endpoints = subscriptions
    .filter((row) => row.disabledReason === null)
    .map((row) => row.endpoint);
  const devices = deviceRowsOf(subscriptions, systemClock());
  const freelancers = spells.filter((spell) => spell.toAt === null);
  // perf: sequential. Their names need their ids; most people coordinate nobody, and then
  // nothing more is read.
  const people =
    freelancers.length > 0 ? await listDirectoryOf(freelancers.map((row) => row.memberId)) : [];
  const isWelcome = welcome === "1";
  // perf: sequential, and only on the welcome screen: whether this new joiner has a walkthrough
  // (members who joined before 5.5 never do), and whether the request came from an iPhone.
  const onboarding = isWelcome ? await readOwnOnboarding() : null;
  const walkthrough =
    onboarding !== null && (!onboarding.finished || onboarding.finishedVia === "test")
      ? { finished: onboarding.finished, ios: isIOS((await headers()).get("user-agent") ?? "", 0) }
      : null;

  const subtitle = viewer.jobTitle
    ? `${ROLE_LABELS[viewer.role]} · ${viewer.jobTitle}`
    : ROLE_LABELS[viewer.role];

  return (
    <>
      <PageHeader
        title={isWelcome ? `Welcome, ${displayName(viewer.name)}` : "Me"}
        description={
          isWelcome
            ? "You're in. Check your name, add a phone number, and you're set."
            : ME_DESCRIPTION
        }
        // The welcome line is the one thing here a phone genuinely needs to be told; the rest
        // of the screen says what it is (ARCHITECTURE §14.1).
        {...(isWelcome
          ? { help: "You're in. Check your name, add a phone number, and you're set." }
          : {})}
      />
      <div className="flex flex-col gap-6">
        {isWelcome ? (
          <Card data-slot="welcome" className="bg-muted/40">
            <CardContent className="flex items-start gap-3 text-sm">
              <PartyPopperIcon className="text-foreground mt-0.5 size-5 shrink-0" aria-hidden />
              <p>
                Your password is set and you are signed in as{" "}
                <span className="font-medium break-all">{viewer.email}</span>. From now on, sign in
                with that email and your password.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {walkthrough ? (
          <OnboardingSteps
            publicKey={push.mode === "on" ? push.publicKey : null}
            endpoints={endpoints}
            ios={walkthrough.ios}
            finished={walkthrough.finished}
          />
        ) : null}

        {/* 1. Who you are: one block (photo, name, role, sign-in email, Edit profile). */}
        <Card data-slot="me-identity">
          <CardContent className="flex flex-col gap-3 text-sm">
            <EditableRecord
              title="Profile"
              subject="self"
              editLabel="Edit profile"
              savedMessage="Profile saved"
              onSave={updateOwnProfile}
              header={
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar size="lg" className="size-12">
                    {own?.avatarFileId ? (
                      <AvatarImage src={fileUrl(own.avatarFileId)} alt="" />
                    ) : null}
                    <AvatarFallback className="text-base">{initialsOf(viewer.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col" data-slot="me-identity-text">
                    <p className="text-base font-semibold break-words">{viewer.name}</p>
                    <p className="text-muted-foreground">{subtitle}</p>
                    <p className="text-muted-foreground break-all" data-slot="me-email">
                      {viewer.email}
                      {/* W4: only the people whose sign-in the Owner changes read this. */}
                      {viewer.role === "owner" ? null : <span> (the Owner changes this)</span>}
                    </p>
                  </div>
                </div>
              }
              fields={[
                {
                  name: "fullName",
                  label: "Full name",
                  noun: "name",
                  value: own?.fullName ?? viewer.name,
                  hideInRead: true,
                  input: { autoComplete: "name", maxLength: NAME_MAX_LENGTH, required: true },
                },
                {
                  name: "phone",
                  label: "Phone",
                  noun: "phone number",
                  value: own?.phone ?? null,
                  hint: "A work contact, visible to the Owner and Admins.",
                  input: {
                    type: "tel",
                    autoComplete: "tel",
                    inputMode: "tel",
                    maxLength: PHONE_MAX_LENGTH,
                  },
                },
              ]}
            />
            <AvatarEditor hasAvatar={Boolean(own?.avatarFileId)} />
          </CardContent>
        </Card>

        {/* 2. My work: whoever marks attendance (Admins and Crew). */}
        {can(viewer.role, "attendance.self") ? (
          <MeSection title="My work" slot="me-work">
            <Card className="gap-0 py-0" data-slot="me-pages">
              <MeRow
                href="/leave"
                slot="me-leave-link"
                title="Attendance & leave"
                body="Request leave and see how each day was recorded."
              />
              <Separator />
              <MeRow
                href="/leave/extra-work"
                slot="me-work-link"
                title="Extra work & expenses"
                body="Note extra work and claim what you spent."
              />
            </Card>
          </MeSection>
        ) : null}

        {/* 3. Your freelancers: an Admin who coordinates one. */}
        {freelancers.length > 0 ? (
          <YourFreelancers freelancers={freelancers} people={people} />
        ) : null}

        {/* 4. Notifications: this device, every device, and a test. */}
        <MeSection title="Notifications" slot="me-notifications">
          <Card>
            <CardContent className="flex flex-col gap-4">
              {/* Notifications on this device (5.2, kickoff 5 decision 9). */}
              <PushDeviceRow
                publicKey={push.mode === "on" ? push.publicKey : null}
                endpoints={endpoints}
              />
              <Separator />
              <section data-slot="me-devices" aria-labelledby="me-devices-title">
                <h3 id="me-devices-title" className="text-sm font-medium">
                  Your devices
                </h3>
                <p className="text-muted-foreground mb-3 text-sm">Where your notifications go.</p>
                <DeviceList rows={devices} />
              </section>
              <Separator />
              <PushTestRow endpoints={endpoints} />
            </CardContent>
          </Card>
        </MeSection>

        {/* 5. Appearance. */}
        <MeSection title="Appearance" slot="me-appearance">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-[1_1_10rem]">
                <p className="text-sm font-medium">
                  Theme
                  <span className="text-muted-foreground font-normal">
                    {" · "}
                    <ThemeLabel />
                  </span>
                </p>
                <p className="text-muted-foreground text-sm">Light, dark or follow the system.</p>
              </div>
              <ThemeToggle />
            </CardContent>
          </Card>
        </MeSection>

        {/* 6. Help. */}
        <Help />

        {/* 7. Sign out, last: a red outline (nothing is destroyed), behind its confirmation. */}
        <div data-slot="me-sign-out-row" className="flex flex-col gap-2">
          <LogoutButton />
          <p className="text-muted-foreground text-sm">
            For a lost or shared device. Notifications stop here until you sign in again.
          </p>
        </div>

        {/* 8. The version, at the very bottom: what to read out when asking for help. */}
        <p className="text-muted-foreground text-xs" data-slot="app-version">
          Version <span className="tabular-nums">{APP_VERSION}</span>
        </p>
      </div>
    </>
  );
}

/** One section of Me: a 14 px heading over its card (FINAL 3; no card inside a card). */
function MeSection({
  title,
  slot,
  children,
}: {
  title: string;
  slot: string;
  children: ReactNode;
}) {
  const id = `${slot}-title`;
  return (
    <section data-slot={slot} aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One row of Me that opens a page of the member's own (a drill-down: it pushes). */
function MeRow({
  href,
  slot,
  title,
  body,
}: {
  href: string;
  slot: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      data-slot={slot}
      className="pressable-row focus-visible:ring-ring flex min-h-14 items-center justify-between gap-4 rounded-xl px-4 py-3 outline-none focus-visible:ring-2"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{body}</p>
      </div>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}

/**
 * Help (V5b, the Me restructure; 5B decision 4 before it): the guide for the reader's role
 * (ROADMAP 6b.14) and Reload app. The test push moved up to Notifications, the version to the very
 * bottom of the page (`NEXT_PUBLIC_APP_VERSION`, the release tag in production, `staging ·
 * 36b4b95` on staging: `core/lib/app-version.ts`).
 */
function Help() {
  return (
    <MeSection title="Help" slot="me-help">
      <Card className="gap-0 py-0">
        <Link
          href="/me/guide"
          data-slot="me-guide-link"
          className="pressable-row focus-visible:ring-ring group/guide flex min-h-14 items-center justify-between gap-4 rounded-xl px-4 py-3 outline-none focus-visible:ring-2"
        >
          {/* Says what opens (unit U): step-by-step help, the reader's role only. */}
          <div className="min-w-0">
            <p className="text-sm font-medium">How MaxOff works</p>
            <p className="text-muted-foreground text-sm">Opens step-by-step help for your role.</p>
          </div>
          <ChevronRightIcon
            className="text-muted-foreground group-hover/guide:text-foreground size-4 shrink-0"
            aria-hidden
          />
        </Link>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0 flex-[1_1_10rem]">
            <p className="text-sm font-medium">Reload app</p>
            <p className="text-muted-foreground text-sm">
              If a screen looks stuck, this starts MaxOff again from the beginning.
            </p>
          </div>
          <ReloadAppButton />
        </div>
      </Card>
    </MeSection>
  );
}

/** Inlined at build time (`next.config.ts`). */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "local";

/**
 * "Your freelancers" (ADR-0013, 4C): the people the member coordinates now, whose tasks they
 * note, update and hand in ("for Asha" in My tasks), with a phone to reach them. Last on the
 * page, so nothing above it moves for a coordinator when it arrives. Only the current ones: the
 * directory names a freelancer to their current coordinator (Kickoff 4 decision 21), and the
 * reason for a change is never here (4A review S4).
 */
function YourFreelancers({
  freelancers,
  people,
}: {
  freelancers: readonly OwnFreelancer[];
  people: readonly TeamMember[];
}) {
  const byId = new Map(people.map((person) => [person.id, person]));
  return (
    <MeSection title="Your freelancers" slot="me-freelancers">
      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            You note, update and hand in their tasks for them.
          </p>
          <ul className="flex flex-col gap-3">
            {freelancers.map((row) => {
              const person = byId.get(row.memberId);
              return (
                <li key={row.memberId} className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-medium break-words">{person?.fullName ?? "A freelancer"}</p>
                  <p className="text-muted-foreground">
                    {person?.jobTitle ? `${person.jobTitle} · ` : ""}
                    {person?.status === "deactivated"
                      ? "deactivated for now"
                      : `since ${formatIST(row.fromAt, "d MMM yyyy")}`}
                  </p>
                  {person?.phone ? (
                    <a
                      href={`tel:${person.phone.replace(/\s+/g, "")}`}
                      className="pressable-row inline-flex min-h-11 min-w-11 items-center self-start underline underline-offset-4"
                    >
                      {person.phone}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </MeSection>
  );
}
