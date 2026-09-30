"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import type { Result, ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Input } from "@/core/ui/primitives/input";
import { Label } from "@/core/ui/primitives/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  addTaskType,
  editTaskType,
  moveTaskType,
  setTaskTypeArchived,
} from "../actions/task-types";
import {
  splitTaskTypes,
  TASK_TYPE_KIND_LABELS,
  TASK_TYPE_KIND_LINES,
  TASK_TYPE_KINDS,
  TASK_TYPE_NAME_MAX,
  taskTypeLine,
  type TaskTypeSetting,
} from "../domain/task-types";
import type { TaskTypeKind } from "../domain/types";

/**
 * Settings → Task types (4C; PRODUCT §4.6, Kickoff 4 decisions 14, 15): the Owner's list. Add
 * (name and kind, and for an event whether it shows on the calendar and asks for a location),
 * edit, reorder one step at a time, archive and restore, in the list-manager shape (1.4): on a
 * phone the row keeps the order buttons and a ⋯ sheet with Edit and Archive. The kind is fixed
 * once the type exists. No reminder editor (5.3's).
 */
export function TaskTypesManager({ types }: { types: readonly TaskTypeSetting[] }) {
  const [editing, setEditing] = useState<TaskTypeSetting | null>(null);
  const [archiving, setArchiving] = useState<TaskTypeSetting | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { active, archived } = splitTaskTypes(types);

  async function run(id: string, call: () => Promise<Result<null>>, success?: string) {
    setBusyId(id);
    toastResult(await call(), success ? { success } : undefined);
    setBusyId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 ? (
        <EmptyState
          icon={ListIcon}
          title="No task types yet"
          description="Add the first one. Types are offered when a task is created."
        />
      ) : (
        <ul
          data-slot="task-types"
          className="border-border divide-border divide-y rounded-lg border"
        >
          {active.map((type, index) => (
            <li
              key={type.id}
              data-slot="task-type"
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
            >
              <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                <span className="truncate text-sm font-medium">{type.name}</span>
                <span className="text-muted-foreground text-xs">{taskTypeLine(type)}</span>
              </div>
              <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${type.name} up`}
                  disabled={index === 0 || busyId !== null}
                  onClick={() =>
                    void run(type.id, () => moveTaskType({ taskTypeId: type.id, direction: "up" }))
                  }
                >
                  <ChevronUpIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${type.name} down`}
                  disabled={index === active.length - 1 || busyId !== null}
                  onClick={() =>
                    void run(type.id, () =>
                      moveTaskType({ taskTypeId: type.id, direction: "down" }),
                    )
                  }
                >
                  <ChevronDownIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${type.name}`}
                  onClick={() => setEditing(type)}
                  className="hidden md:inline-flex"
                >
                  <PencilIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  aria-label={`Archive ${type.name}`}
                  onClick={() => setArchiving(type)}
                  className="hidden md:inline-flex"
                >
                  <ArchiveIcon aria-hidden />
                </Button>
                <TypeActionsSheet
                  name={type.name}
                  onEdit={() => setEditing(type)}
                  onArchive={() => setArchiving(type)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">Archived</h2>
          <p className="text-muted-foreground text-sm">
            Not offered for new tasks. Tasks that already have one keep it.
          </p>
          <ul
            data-slot="archived-task-types"
            className="border-border divide-border divide-y rounded-lg border"
          >
            {archived.map((type) => (
              <li
                key={type.id}
                data-slot="archived-task-type"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <span className={cn("text-muted-foreground truncate text-sm", CARD_ROW_TITLE)}>
                  {type.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={CARD_ROW_TRAILING}
                  disabled={busyId !== null}
                  onClick={() =>
                    void run(
                      type.id,
                      () => setTaskTypeArchived({ taskTypeId: type.id, archived: false }),
                      "Task type restored",
                    )
                  }
                >
                  <ArchiveRestoreIcon aria-hidden />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editing ? (
        <TaskTypeDialog key={editing.id} type={editing} onClose={() => setEditing(null)} />
      ) : null}
      {archiving ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          title={`Archive ${archiving.name}?`}
          description="New tasks stop offering it. Tasks that already have it keep it, and you can restore it later."
          confirmLabel={`Archive ${archiving.name}`}
          pendingLabel="Archiving…"
          onConfirm={async () => {
            toastResult(await setTaskTypeArchived({ taskTypeId: archiving.id, archived: true }), {
              success: "Task type archived",
            });
            setArchiving(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Edit and Archive on a phone (1.5's shape): four 44px targets and a name do not fit at 375px. */
function TypeActionsSheet({
  name,
  onEdit,
  onArchive,
}: {
  name: string;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  function choose(then: () => void) {
    setOpen(false);
    then();
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${name}`}
          className="md:hidden"
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        data-slot="task-type-actions"
        className="gap-3 rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pr-12 pb-0">
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription className="sr-only">Task type actions</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => choose(onEdit)}
          >
            <PencilIcon aria-hidden />
            Edit
          </Button>
          <Button
            variant="destructive"
            className="w-full justify-start"
            onClick={() => choose(onArchive)}
          >
            <ArchiveIcon aria-hidden />
            Archive
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The screen's one primary action, for `PageHeader` (a FAB on a phone). */
export function AddTaskTypeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)} data-slot="add-task-type">
        <PlusIcon aria-hidden />
        Add task type
      </Button>
      {open ? <TaskTypeDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Add or edit one task type. The kind is chosen once (it shapes the task form); an event's two
 * switches stay editable. Mounted fresh per type (`key=` at the call site).
 */
function TaskTypeDialog({ type, onClose }: { type?: TaskTypeSetting; onClose: () => void }) {
  const editing = type !== undefined;
  const [name, setName] = useState(type?.name ?? "");
  const [kind, setKind] = useState<TaskTypeKind>(type?.kind ?? "normal");
  const [showsOnCalendar, setShowsOnCalendar] = useState(type?.showsOnCalendar ?? true);
  const [hasLocation, setHasLocation] = useState(type?.hasLocation ?? false);
  const [error, setError] = useState<ResultError | null>(null);
  const kindName = useId();
  const action = useAction(
    async () => {
      const switches = {
        showsOnCalendar: kind === "event" && showsOnCalendar,
        hasLocation: kind === "event" && hasLocation,
      };
      const result: Result<unknown> = editing
        ? await editTaskType({ taskTypeId: type.id, name, ...switches })
        : await addTaskType({ name, kind, ...switches });
      if (result.ok) {
        toastResult(result, { success: editing ? "Task type saved" : "Task type added" });
        onClose();
      } else {
        setError(result.error);
      }
    },
    { creates: !editing },
  );
  const { pending } = action;
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    action.run();
  }

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${type.name}` : "Add a task type"}</DialogTitle>
            <DialogDescription>
              {editing
                ? `${TASK_TYPE_KIND_LABELS[type.kind]}: the kind stays as it is, since tasks were shaped by it.`
                : "Offered whenever a task is created. The kind decides what the task asks for."}
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Name" error={error?.fieldErrors?.name}>
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={TASK_TYPE_NAME_MAX}
                autoComplete="off"
                required
              />
            )}
          </FormField>
          {editing ? null : (
            <fieldset className="flex min-w-0 flex-col gap-2" data-slot="task-type-kind">
              <legend className="mb-1.5 text-sm font-medium">Kind</legend>
              {TASK_TYPE_KINDS.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "border-border flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                    kind === option && "border-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name={kindName}
                    value={option}
                    checked={kind === option}
                    onChange={() => setKind(option)}
                    className="accent-foreground mt-0.5 size-5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{TASK_TYPE_KIND_LABELS[option]}</span>
                    <span className="text-muted-foreground">{TASK_TYPE_KIND_LINES[option]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {kind === "event" ? (
            <div className="flex flex-col gap-1">
              <Label className="flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={showsOnCalendar}
                  onCheckedChange={(next) => setShowsOnCalendar(next === true)}
                />
                <span>Show these tasks on the calendar</span>
              </Label>
              <Label className="flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={hasLocation}
                  onCheckedChange={(next) => setHasLocation(next === true)}
                />
                <span>Ask for a location</span>
              </Label>
            </div>
          ) : null}
          <ActionStatus action={action} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              pending={pending}
              pendingLabel={editing ? "Saving…" : "Adding…"}
            >
              {editing ? "Save" : "Add task type"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
