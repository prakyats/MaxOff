import { ChevronRightIcon, PartyPopperIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LogoutButton } from "@/core/auth/components/logout-button";
import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { EditableRecord } from "@/core/ui/composites/editable-record";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Avatar, AvatarFallback } from "@/core/ui/primitives/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { initialsOf, ROLE_LABELS } from "@/core/ui/shell/viewer";
import { ThemeToggle } from "@/core/ui/theme/theme-toggle";
import { getOwnMember, NAME_MAX_LENGTH, PHONE_MAX_LENGTH, updateOwnProfile } from "@/modules/team";

export const metadata: Metadata = { title: "Me" };

/**
 * Profile, own attendance and leave (2.3), appearance and log out (PRODUCT §4.7: the Staff
 * "Me" tab). An accepted invite lands here with `?welcome=1` (WORKFLOWS §1a) to check the name
 * and add a phone. Avatar upload joins in 3.3.
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
  const viewer = await requireMember();
  const [{ welcome }, own] = await Promise.all([searchParams, getOwnMember(viewer.id)]);
  const isWelcome = welcome === "1";

  const subtitle = viewer.jobTitle
    ? `${ROLE_LABELS[viewer.role]} · ${viewer.jobTitle}`
    : ROLE_LABELS[viewer.role];

  return (
    <>
      <PageHeader
        title={isWelcome ? `Welcome, ${viewer.name.split(" ")[0]}` : "Me"}
        description={
          isWelcome
            ? "You're in. Check your name, add a phone number, and you're set."
            : "Your profile, appearance and session."
        }
        // The welcome line is the one thing here a phone genuinely needs to be told; the rest
        // of the screen says what it is (ARCHITECTURE §14.1).
        {...(isWelcome
          ? { help: "You're in. Check your name, add a phone number, and you're set." }
          : {})}
      />
      <div className="flex max-w-xl flex-col gap-4">
        {isWelcome ? (
          <Card data-slot="welcome" className="border-brand/40 bg-brand/5">
            <CardContent className="flex items-start gap-3 text-sm">
              <PartyPopperIcon className="text-brand mt-0.5 size-5 shrink-0" aria-hidden />
              <p>
                Your password is set and you are signed in as{" "}
                <span className="font-medium break-all">{viewer.email}</span>. From now on, sign in
                with that email and your password.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <Avatar size="lg">
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
          <Card className="py-0">
            {/* Own leave and history (2.3): personal, so it lives here, not in the nav. */}
            <Link
              href="/leave"
              data-slot="me-leave-link"
              className="active:bg-muted/60 focus-visible:ring-ring flex min-h-14 items-center justify-between gap-4 rounded-xl px-4 py-3 outline-none focus-visible:ring-2"
            >
              <div>
                <p className="text-sm font-medium">Attendance &amp; leave</p>
                <p className="text-muted-foreground text-sm">
                  Request leave and see how each day was recorded.
                </p>
              </div>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </Link>
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
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-[1_1_10rem]">
                <p className="text-sm font-medium">Session</p>
                <p className="text-muted-foreground text-sm">
                  Logging out records the time, on this device only.
                </p>
              </div>
              <LogoutButton />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
