"use client";

import { FlaskConicalIcon } from "lucide-react";
import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";

import { setPreviewRole } from "./preview-role-actions";
import { ROLE_LABELS, SHELL_ROLES, type ShellRole } from "./viewer";

/**
 * DEVELOPMENT-ONLY SHIM (see `preview-viewer.ts`). Rendered by the shell only when
 * `NODE_ENV !== "production"`. Deleted in task 1.2.
 */
export function PreviewRoleSwitcher({ role }: { role: ShellRole }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="border-attention/40 bg-attention-soft text-attention flex min-w-0 flex-col gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate font-medium">Preview as</span>
      </div>
      <Select
        value={role}
        disabled={pending}
        onValueChange={(next) => startTransition(() => setPreviewRole(next))}
      >
        <SelectTrigger
          size="sm"
          className="bg-card text-foreground h-7 w-full"
          aria-label="Preview role"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SHELL_ROLES.map((value) => (
            <SelectItem key={value} value={value}>
              {ROLE_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
