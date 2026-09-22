import { LogOutIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/core/ui/composites/page-header";
import { Avatar, AvatarFallback } from "@/core/ui/primitives/avatar";
import { Button } from "@/core/ui/primitives/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { getPreviewViewer } from "@/core/ui/shell/preview-viewer";
import { initialsOf, ROLE_LABELS } from "@/core/ui/shell/viewer";
import { ThemeToggle } from "@/core/ui/theme/theme-toggle";

export const metadata: Metadata = { title: "Me" };

/**
 * Profile, appearance and log out (PRODUCT §4.7: the Staff "Me" tab). Profile editing lands
 * in task 1.3 and log out in task 1.2.
 */
export default async function MePage() {
  const viewer = await getPreviewViewer();
  if (!viewer) notFound();

  const subtitle = viewer.jobTitle
    ? `${ROLE_LABELS[viewer.role]} · ${viewer.jobTitle}`
    : ROLE_LABELS[viewer.role];

  return (
    <>
      <PageHeader title="Me" description="Your profile, appearance and session." />
      <div className="flex max-w-xl flex-col gap-4">
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
          <CardContent className="text-muted-foreground text-sm">
            Editing your name and avatar is filled in task 1.3.
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
                  Logging out records the time. Filled in task 1.2.
                </p>
              </div>
              <Button variant="outline" disabled>
                <LogOutIcon aria-hidden />
                Log out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
