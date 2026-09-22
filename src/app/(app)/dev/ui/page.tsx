import { InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/core/ui/composites/empty-state";
import { ErrorState } from "@/core/ui/composites/error-state";
import { Forbidden } from "@/core/ui/composites/forbidden";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { NotFound } from "@/core/ui/composites/not-found";
import { PageHeader } from "@/core/ui/composites/page-header";
import { STATUS_TONES, StatusBadge } from "@/core/ui/composites/status-badge";
import { Badge } from "@/core/ui/primitives/badge";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";

import { isDevGalleryEnabled } from "./enabled";
import { GalleryInteractive } from "./gallery-interactive";

// Static `metadata` is resolved even when the page throws notFound(), which put "UI gallery"
// in the production 404's <title>. Guarded here so a production build leaves no trace
// (`e2e/production.spec.ts`).
export function generateMetadata(): Metadata {
  return isDevGalleryEnabled(process.env.NODE_ENV) ? { title: "UI gallery" } : {};
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * DEVELOPMENT-ONLY gallery of every composite and its states, for eyeballing both themes
 * at desktop and 375px. Returns 404 in production (`enabled.test.ts`). Deleted in task 1.2.
 */
export default function UiGalleryPage() {
  if (!isDevGalleryEnabled(process.env.NODE_ENV)) notFound();

  return (
    <>
      <PageHeader
        title="UI gallery"
        description="Every shared component in its loading, empty, error and denied states."
        actions={
          <>
            <Button variant="outline">Secondary</Button>
            <Button>Primary action</Button>
          </>
        }
      />
      <div className="flex flex-col gap-10">
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button size="xs">Extra small</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Status badges (DATA-MODEL §0)">
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(STATUS_TONES).map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
            <Badge>Plain badge</Badge>
          </div>
        </Section>

        <Section title="Form fields">
          <div className="grid max-w-md gap-4">
            <div className="grid gap-2">
              <Label htmlFor="g-name">Name</Label>
              <Input id="g-name" placeholder="Client name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="g-invalid">With an error</Label>
              <Input
                id="g-invalid"
                defaultValue="x"
                aria-invalid
                aria-describedby="g-invalid-msg"
              />
              <p id="g-invalid-msg" className="text-destructive text-sm">
                Please write a few more words.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="g-notes">Notes</Label>
              <Textarea id="g-notes" placeholder="Anything the team should know" />
            </div>
          </div>
        </Section>

        <Section title="States">
          <div className="grid gap-4 lg:grid-cols-2">
            <LoadingState
              rows={3}
              className="border-border bg-card rounded-lg border border-solid p-4"
            />
            <EmptyState
              icon={InboxIcon}
              title="No approvals waiting"
              description="Anything submitted for your decision shows up here."
              action={<Button variant="outline">Create a task</Button>}
            />
            <ErrorState
              description="The list couldn't load. Try again in a moment."
              action={<Button>Try again</Button>}
            />
            <Forbidden />
            <NotFound />
          </div>
        </Section>

        <GalleryInteractive />
      </div>
    </>
  );
}
