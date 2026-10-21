"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors/result";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Input } from "@/core/ui/primitives/input";
import { describeError } from "@/core/ui/toast";

const NAME_MAX = 120;

/**
 * "Save as template" (6b Release 2; ROADMAP 6b.13 (b), 6b.16): a small layer asking the
 * template's name (the record's own name to start with), then a toast with a way to Settings →
 * Templates. A copy, never linked: the record stays exactly as it is. Back closes it (§14.2 a);
 * nothing is typed that a close would lose but the name, so it asks nothing.
 */
export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  what,
  initialName,
  save,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "project" or "deliverable": the words of the layer. */
  what: "project" | "deliverable";
  initialName: string;
  save: (name: string) => Promise<Result<{ id: string }>>;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Name the template.");
      return;
    }
    setPending(true);
    const result = await save(name);
    setPending(false);
    if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(result.error.fieldErrors?.name?.[0] ?? description ?? title);
      return;
    }
    toast.success(`Saved as the template ${name.trim()}`, {
      action: { label: "Open templates", onClick: () => router.push("/settings/templates") },
    });
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent data-slot="save-as-template-dialog">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              {what === "project"
                ? "A project template with the structure only: the repeat, the default stage groups and the deliverables with their stages. Never the description or custom field values. The project stays as it is."
                : "A deliverable template with its stage groups (no ticks or dates). The deliverable stays as it is."}
            </DialogDescription>
          </DialogHeader>
          <FormField label="Template name" error={error ?? undefined}>
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={NAME_MAX}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(null);
                }}
                required
                autoFocus
              />
            )}
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving…">
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
