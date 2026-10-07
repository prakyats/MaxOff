import { ChevronRightIcon, PartyPopperIcon } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { ReloadAppButton } from "@/core/ui/shell/reload-app-button";
import { initialsOf } from "@/core/ui/shell/viewer";
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
 * Profile, the member's own pages (Extra work & expenses since 5B decision 3; Attendance & leave
 * too for an Admin, whose navigation has no Leave tab, decision 7), appearance, notifications on
 * this device and "Sign out of this device" (PRODUCT §4.7: the Staff "Me" tab; kickoff 3b
 * decision 1: the sign-out lives here only), and at the bottom one quiet "Help &
 * troubleshooting" section (5B decision 4): Send a test notification (5.2), Reload app and the
 * app's version. An accepted invite lands here with `?welcome=1` (WORKFLOWS §1a) to check the name
 * and add a phone, and, for a member who joined after 5.5 shipped, the walkthrough that gets
 * notifications working (owner decisions 2026-10-03, 3 and 4); their every sign-in lands here
 * again until they finish it or tap Later (owner 2026-10-06). **Your devices** (5.5, decision 5)
 * lists every device of theirs, each other one with Remove. The photo is chosen through `AvatarEditor` (3.3): the original is kept and
 * a browser-made preview is what the app shows.
 *
 * The profile is read-only first and edited through the edit pattern (`EditableRecord`, task
 * 2.9, ARCHITECTURE §14.1): it is who you are in the app, so a change is deliberate and named
 * before it is saved. Appearance and Log out stay instant: a view preference and an action,
 * not identity.
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
      <div className="flex max-w-xl flex-col gap-4">
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

        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <Avatar size="lg">
                {own?.avatarFileId ? <AvatarImage src={fileUrl(own.avatarFileId)} alt="" /> : null}
                <AvatarFallback>{initialsOf(viewer.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <CardTitle className="truncate">{viewer.name}</CardTitle>
                <CardDescription>{subtitle}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p>
              <span className="text-muted-foreground">Signs in as </span>
              <span className="font-medium break-all">{viewer.email}</span>
              <span className="text-muted-foreground"> (the Owner changes this)</span>
            </p>
            <AvatarEditor hasAvatar={Boolean(own?.avatarFileId)} />
            <Separator />
            <EditableRecord
              title="Profile"
              subject="self"
              editLabel="Edit profile"
              savedMessage="Profile saved"
              onSave={updateOwnProfile}
              fields={[
                {
                  name: "fullName",
                  label: "Full name",
                  noun: "name",
                  value: own?.fullName ?? viewer.name,
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
          </CardContent>
        </Card>

        {can(viewer.role, "attendance.self") ? (
          <Card className="gap-0 py-0" data-slot="me-pages">
            {viewer.role === "staff" ? null : (
              <>
                <MeRow
                  href="/leave"
                  slot="me-leave-link"
                  title="Attendance & leave"
                  body="Request leave and see how each day was recorded."
                />
                <Separator />
              </>
            )}
            <MeRow
              href="/leave/extra-work"
              slot="me-work-link"
              title="Extra work & expenses"
              body="Note extra work and claim what you spent."
            />
          </Card>
        ) : null}

        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-[1_1_10rem]">
                <p className="text-sm font-medium">Appearance</p>
                <p className="text-muted-foreground text-sm">Light, dark or follow the system.</p>
              </div>
              <ThemeToggle />
            </div>
            <Separator />
            {/* Notifications on this device (5.2, kickoff 5 decision 9). */}
            <PushDeviceRow
              publicKey={push.mode === "on" ? push.publicKey : null}
              endpoints={endpoints}
            />
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-[1_1_10rem]">
                <p className="text-sm font-medium">Sign out of this device</p>
                <p className="text-muted-foreground text-sm">
                  For a lost or shared device. Notifications stop here until you sign in again.
                </p>
              </div>
              <LogoutButton />
            </div>
          </CardContent>
        </Card>

        <Card data-slot="me-devices">
          <CardHeader>
            <CardTitle>Your devices</CardTitle>
            <CardDescription>Where your notifications go.</CardDescription>
          </CardHeader>
          <CardContent>
            <DeviceList rows={devices} />
          </CardContent>
        </Card>

        {freelancers.length > 0 ? (
          <YourFreelancers freelancers={freelancers} people={people} />
        ) : null}

        <HelpAndTroubleshooting endpoints={endpoints} />
      </div>
    </>
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
 * "Help & troubleshooting" (5B decision 4): quiet, last on Me. The test push and Reload app moved
 * here from the device card, and the app's version (`NEXT_PUBLIC_APP_VERSION`, the release tag or
 * the branch and commit: `core/lib/app-version.ts`) is what to read out when asking for help.
 */
function HelpAndTroubleshooting({ endpoints }: { endpoints: readonly string[] }) {
  return (
    <Card data-slot="me-help">
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">
          Help &amp; troubleshooting
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PushTestRow endpoints={endpoints} />
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-[1_1_10rem]">
            <p className="text-sm font-medium">Reload app</p>
            <p className="text-muted-foreground text-sm">
              If a screen looks stuck, this starts MaxOff again from the beginning.
            </p>
          </div>
          <ReloadAppButton />
        </div>
        <Separator />
        <p className="text-muted-foreground text-sm" data-slot="app-version">
          Version <span className="text-foreground font-medium tabular-nums">{APP_VERSION}</span>
        </p>
      </CardContent>
    </Card>
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
    <Card data-slot="me-freelancers">
      <CardHeader>
        <CardTitle>Your freelancers</CardTitle>
        <CardDescription>You note, update and hand in their tasks for them.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
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
  );
}
