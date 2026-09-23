import { PartyPopperIcon } from "lucide-react";
import type { Metadata } from "next";

import { LogoutButton } from "@/core/auth/components";
import { requireMember } from "@/core/auth/server";
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
import { getOwnMember, ProfileForm } from "@/modules/team";

export const metadata: Metadata = { title: "Me" };

/**
 * Profile, appearance and log out (PRODUCT §4.7: the Staff "Me" tab). An accepted invite
 * lands here with `?welcome=1` (WORKFLOWS §1a) to check the name and add a phone. Avatar
 * upload joins in 3.3.
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
      />
      <div className="flex max-w-xl flex-col gap-4">
        {isWelcome ? (
          <Card data-slot="welcome" className="border-brand/40 bg-brand/5">
            <CardContent className="flex items-start gap-3 text-sm">
              <PartyPopperIcon className="text-brand mt-0.5 size-5 shrink-0" aria-hidden />
              <p>
                Your password is set and you are signed in as{" "}
                <span className="font-medium">{viewer.email}</span>. From now on, sign in with that
                email and your password.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
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
              <span className="font-medium">{viewer.email}</span>
              <span className="text-muted-foreground"> (the Owner changes this)</span>
            </p>
            <Separator />
            <ProfileForm fullName={own?.fullName ?? viewer.name} phone={own?.phone ?? null} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Appearance</p>
                <p className="text-muted-foreground text-sm">Light, dark or follow the system.</p>
              </div>
              <ThemeToggle />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
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
