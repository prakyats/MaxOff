"use client";

import { AlertTriangleIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";

import type { FieldDefinition } from "@/core/custom-fields";
import { CustomFieldsForm } from "@/core/custom-fields/components/custom-fields-form";
import type { ResultError } from "@/core/errors/result";
import { ROLE_LABELS } from "@/core/lib/role-labels";
import { type ISODate, isISODate, systemClock, toISTDate } from "@/core/time";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";
import { toast } from "sonner";

import { convertRequest } from "../actions/requests";
import { createTask, loadAvailability, updateTask } from "../actions/tasks";
import {
  addAssignee,
  assignmentChange,
  type DraftErrors,
  draftChanges,
  draftEventWindow,
  draftFromTask,
  draftType,
  emptyDraft,
  fieldsFromTask,
  isDraftDirty,
  keepFieldKeys,
  removeAssignee,
  type TaskDraft,
  taskFromDraft,
  validateDraft,
} from "../domain/form";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  PURPOSE_MAX,
  STAGE_NAME_MAX,
  STAGES_MAX,
  TITLE_MAX,
} from "../domain/limits";
import { isFinal } from "../domain/task";
import { applyTemplate, type TaskTemplate } from "../domain/templates";
import {
  type AdminOption,
  type AssignablePerson,
  type ClientOption,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  type Task,
  type TaskAssignee,
  type TaskType,
} from "../domain/types";
import {
  type AssignmentWarning,
  assignmentWarnings,
  type AvailabilityDay,
  availabilityDays,
  eventWindow,
  warningsToRecord,
} from "../domain/warnings";

/** What the dialog needs, read by the page and handed over as a promise (it opens on a tap). */
export type TaskFormSetup = {
  viewerId: string;
  isOwner: boolean;
  today: ISODate;
  /** `org_settings.workload_warning_threshold` (kickoff 4 decision 11). */
  threshold: number;
  types: TaskType[];
  /** Active Admins, Staff and freelancers; never the Owner (kickoff 4 decision 1). */
  people: AssignablePerson[];
  /** The Owner: every client not closed; an Admin: their own (kickoff 4 decision 2). */
  clients: ClientOption[];
  /** The Owner's approver choices: every active Admin (kickoff 4 decision 3). */
  admins: AdminOption[];
  /** Task custom fields, company-wide and per type, archived included. */
  definitions: FieldDefinition[];
  /** The active task templates, for "Start from" (4.6; shared company-wide, decision 19). */
  templates: TaskTemplate[];
};

export type TaskFormMode =
  | { kind: "create" }
  /** A suggested task made into one (4.6, WORKFLOWS §3.4): the form starts from the request. */
  | { kind: "convert"; request: ConvertedRequest }
  | {
      kind: "edit";
      task: Task;
      assignees: TaskAssignee[];
      /** The label's name, when the viewer's client list does not hold it (another Admin's). */
      clientName: string | null;
    };

/**
 * The suggestion a "Make it a task" form starts from: its title, its details as the description,
 * its client label and, for the Owner, that client's Admin as "Checked first by" (Kickoff 4
 * decision 3, as picking the label does).
 */
export type ConvertedRequest = {
  id: string;
  title: string;
  details: string | null;
  clientId: string | null;
  approverId: string | null;
};

const NO_CLIENT = "__none__";
const NO_TEMPLATE = "__no_template__";
const OWNER_APPROVES = "__owner__";
const ADD_PERSON = "";

/**
 * Create or edit a task (4.3; PRODUCT §4.6, WORKFLOWS §3.1, kickoff 4 decisions 1–4, 11–15,
 * ADR-0013). A bottom sheet on a phone, a dialog from `md` up (§14.1), with the commit sticky at
 * the sheet's foot. The type decides the fields (an event's date, times, location and purpose);
 * the people picked get their warnings (workload, overlap, leave) under their names as soon as the
 * deadline or the event is set, from `member_availability()`; the ones kept are recorded as
 * overridden when the task is saved. Never blocking.
 *
 * A layer (§14.2 a): back closes it, and asks "Discard?" first when something was typed (§14.2 f).
 * Creating backs the sheet's entry out and opens the new task (§14.2 b, e: back returns to Tasks,
 * never to the form); saving an edit closes it on the task page.
 */
export function TaskFormDialog({
  setup,
  mode,
  onClose,
}: {
  setup: Promise<TaskFormSetup | null>;
  mode: TaskFormMode;
  onClose: () => void;
}) {
  const [initial] = useState<TaskDraft>(() => {
    if (mode.kind === "edit") return draftFromTask(mode.task, mode.assignees);
    if (mode.kind === "convert") {
      return {
        ...emptyDraft(),
        title: mode.request.title,
        description: mode.request.details ?? "",
        clientId: mode.request.clientId ?? "",
        approverId: mode.request.approverId ?? "",
      };
    }
    return emptyDraft();
  });
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const busy = useRef(false);
  // Set while a save backs the layer out, so the close it causes asks nothing.
  const leaving = useRef(false);
  const dirty = isDraftDirty(initial, draft);
  const creating = mode.kind !== "edit";

  function requestClose() {
    if (busy.current || leaving.current) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent className="md:max-w-xl" data-slot="task-form-dialog">
          <DialogHeader>
            <DialogTitle>
              {mode.kind === "convert" ? "Make it a task" : creating ? "New task" : "Edit task"}
            </DialogTitle>
            <DialogDescription>
              {mode.kind === "convert"
                ? "Starts from the suggestion. Whoever suggested it sees that it became a task."
                : creating
                  ? "Everyone you assign notes it; the primary owner marks it done."
                  : "Changes are recorded in the task's history."}
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<FormSkeleton />}>
            <TaskForm
              setup={setup}
              mode={mode}
              draft={draft}
              setDraft={setDraft}
              dirty={dirty}
              onCancel={requestClose}
              onBusy={(value) => {
                busy.current = value;
              }}
              onLeave={() => {
                leaving.current = true;
              }}
              onClose={onClose}
            />
          </Suspense>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={phase === "discard"}
        onOpenChange={(open) => {
          if (!open) setPhase("form");
        }}
        title={creating ? "Discard this task?" : "Discard your changes?"}
        description={creating ? "What you typed has not been saved." : "The task stays as it was."}
        confirmLabel={creating ? "Discard task" : "Discard changes"}
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}

/** The fields' tracing while the setup loads: title, type and priority, people, deadline. */
function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4" data-slot="task-form-skeleton">
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-col gap-4 sm:flex-row">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 flex-1" />
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="flex gap-4">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 w-32" />
      </div>
      <div className="flex justify-end gap-2">
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-32" />
      </div>
    </div>
  );
}

/** Where a server field error shows in the form. */
const SERVER_FIELDS: Record<string, keyof DraftErrors> = {
  title: "title",
  description: "description",
  taskTypeId: "taskTypeId",
  assigneeIds: "assigneeIds",
  primaryOwnerId: "assigneeIds",
  dueAt: "dueDate",
  eventDate: "eventDate",
  eventStartAt: "eventStart",
  eventEndAt: "eventEnd",
  location: "location",
  purpose: "purpose",
  stages: "stages",
};

function personMeta(person: AssignablePerson): string {
  if (person.engagement === "freelance") {
    return person.coordinatorName ? `Freelancer · with ${person.coordinatorName}` : "Freelancer";
  }
  return person.jobTitle ?? ROLE_LABELS[person.role];
}

function TaskForm({
  setup,
  mode,
  draft,
  setDraft,
  dirty,
  onCancel,
  onBusy,
  onLeave,
  onClose,
}: {
  setup: Promise<TaskFormSetup | null>;
  mode: TaskFormMode;
  draft: TaskDraft;
  setDraft: (next: TaskDraft | ((current: TaskDraft) => TaskDraft)) => void;
  dirty: boolean;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const loaded = use(setup);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<ResultError | null>(null);
  const creating = mode.kind !== "edit";

  const type = loaded ? draftType(draft, loaded.types) : null;
  const isEvent = type?.kind === "event";
  const dueDay = isISODate(draft.dueDate) ? draft.dueDate : null;
  const eventDay = isEvent && isISODate(draft.eventDate) ? draft.eventDate : null;
  const days = availabilityDays(dueDay, eventDay);
  const peopleKey = draft.assigneeIds.join(",");
  const daysKey = days.join(",");
  const checkKey = `${peopleKey}|${daysKey}`;
  const needsCheck = days.length > 0 && draft.assigneeIds.length > 0;
  const [checked, setChecked] = useState<{
    key: string;
    rows: AvailabilityDay[];
    failed: boolean;
  } | null>(null);
  const checking = needsCheck && checked?.key !== checkKey;

  // The warning check: once the people and a day are known, and again whenever either changes.
  useEffect(() => {
    if (!needsCheck) return;
    let live = true;
    const timer = setTimeout(() => {
      void loadAvailability({ memberIds: peopleKey.split(","), days: daysKey.split(",") })
        .then((result) => {
          if (!live) return;
          setChecked({ key: checkKey, rows: result.ok ? result.data : [], failed: !result.ok });
        })
        .catch(() => {
          if (live) setChecked({ key: checkKey, rows: [], failed: true });
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [checkKey, peopleKey, daysKey, needsCheck]);

  const current = useMemo(() => {
    if (mode.kind !== "edit") return undefined;
    return {
      memberIds: mode.assignees.filter((a) => a.removedAt === null).map((a) => a.memberId),
      dueDate: toISTDate(mode.task.dueAt),
      eventDate: mode.task.eventDate,
      eventWindow: eventWindow(mode.task.eventStartAt, mode.task.eventEndAt),
      open: !isFinal(mode.task.state),
    };
  }, [mode]);

  const warnings: AssignmentWarning[] =
    loaded && needsCheck && checked?.key === checkKey
      ? assignmentWarnings({
          memberIds: draft.assigneeIds,
          dueDate: dueDay,
          eventDate: eventDay,
          eventWindow: draftEventWindow(draft, type),
          threshold: loaded.threshold,
          availability: checked.rows,
          current,
        })
      : [];

  // One request per tap, "Creating…" / "Saving…" at once, a slow or lost connection said under
  // the form (ARCHITECTURE §14.1). A create offers no Retry after a lost reply: it could make the
  // task twice. `send` reads the form when it runs, so a Retry of an edit sends what is on screen.
  const action = useAction(send, { creates: creating });
  const { pending } = action;

  if (!loaded) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorText slot="form-alert">
          The form could not be loaded. Close this and try again.
        </ErrorText>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const people = new Map(loaded.people.map((person) => [person.id, person]));
  const clients: ClientOption[] =
    mode.kind === "edit" &&
    mode.task.clientId &&
    !loaded.clients.some((client) => client.id === mode.task.clientId)
      ? [
          ...loaded.clients,
          { id: mode.task.clientId, name: mode.clientName ?? "Current client", adminId: null },
        ]
      : loaded.clients;
  const types = loaded.types.filter((option) => !option.archived || option.id === draft.taskTypeId);
  // A suggestion's client may have closed since (a label is Active or Paused, decision 22).
  const clientOffered = draft.clientId === "" || clients.some((c) => c.id === draft.clientId);
  const templates = creating ? loaded.templates : [];
  const definitions = loaded.definitions.filter(
    (definition) => definition.taskTypeId === null || definition.taskTypeId === type?.id,
  );
  const available = loaded.people.filter((person) => !draft.assigneeIds.includes(person.id));
  // An approver no longer offered (a suggestion's client Admin who left since) is nobody's pick.
  const approverId = loaded.admins.some((admin) => admin.id === draft.approverId)
    ? draft.approverId
    : "";

  function update(patch: Partial<TaskDraft>, clear: (keyof DraftErrors)[] = []) {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }));
    if (clear.length > 0) {
      setErrors((currentErrors) => {
        const next = { ...currentErrors };
        for (const key of clear) delete next[key];
        return next;
      });
    }
    setFormError(null);
  }

  function pickClient(value: string) {
    const clientId = value === NO_CLIENT ? "" : value;
    const patch: Partial<TaskDraft> = { clientId };
    // Kickoff 4 decision 3: a label pre-selects that client's Admin for the Owner.
    if (loaded?.isOwner && creating) {
      const admin = clients.find((client) => client.id === clientId)?.adminId ?? null;
      if (admin && loaded.admins.some((option) => option.id === admin)) patch.approverId = admin;
    }
    update(patch);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || !type) return;
    const found = validateDraft(draft, type, { creating, now: systemClock() });
    setErrors(found);
    setCustomErrors({});
    if (Object.keys(found).length > 0 || checking) return;
    action.run();
  }

  async function send() {
    if (!loaded || !type) return;
    const found = validateDraft(draft, type, { creating, now: systemClock() });
    if (Object.keys(found).length > 0 || checking) {
      setErrors(found);
      return;
    }

    const applies = definitions.map((definition) => definition.key);
    const after = taskFromDraft(
      {
        ...draft,
        clientId: clientOffered ? draft.clientId : "",
        customFields: keepFieldKeys(draft.customFields, applies),
      },
      type,
    );
    const warningInput = (list: AssignmentWarning[]) =>
      list.map((warning) => ({
        kind: warning.kind,
        memberId: warning.memberId,
        details: warning.details,
      }));

    onBusy(true);
    try {
      if (mode.kind !== "edit") {
        const fields = {
          ...after,
          approvingAdminId: loaded.isOwner ? approverId || null : null,
          stages: draft.stages.map((stage) => stage.trim()).filter(Boolean),
          warnings: warningInput(warnings),
          templateId: draft.templateId || null,
        };
        const result =
          mode.kind === "convert"
            ? await convertRequest({ ...fields, requestId: mode.request.id })
            : await createTask(fields);
        if (!result.ok) {
          showServerError(result.error);
          return;
        }
        toast.success("Task created");
        onLeave();
        const href = `/tasks/${result.data.id}`;
        closeOverlaysThen(() => router.push(href, { transitionTypes: [NAV_FORWARD] }));
        return;
      }
      const before = fieldsFromTask(mode.task, mode.assignees);
      const changes = draftChanges(before, after);
      if (Object.keys(changes).length === 0) {
        setFormError({ code: "VALIDATION", message: "Nothing changed." });
        return;
      }
      const result = await updateTask({
        taskId: mode.task.id,
        changes,
        warnings: warningInput(warningsToRecord(warnings, assignmentChange(before, after))),
      });
      if (!result.ok) {
        showServerError(result.error);
        return;
      }
      toast.success("Task saved");
      onLeave();
      closeOverlaysThen(onClose);
    } finally {
      onBusy(false);
    }
  }

  function showServerError(error: ResultError) {
    const fields = error.fieldErrors ?? {};
    const mapped: DraftErrors = {};
    const custom: Record<string, string[]> = {};
    for (const [key, messages] of Object.entries(fields)) {
      if (key.startsWith("customFields.")) custom[key] = messages;
      else {
        const target = SERVER_FIELDS[key.split(".")[0] ?? ""];
        if (target && messages[0]) mapped[target] = messages[0];
      }
    }
    setErrors(mapped);
    setCustomErrors(custom);
    if (Object.keys(mapped).length === 0 && Object.keys(custom).length === 0) setFormError(error);
  }

  const summary = formError ? describeError(formError) : null;
  const warningsByPerson = new Map<string, AssignmentWarning[]>();
  for (const warning of warnings) {
    warningsByPerson.set(warning.memberId, [
      ...(warningsByPerson.get(warning.memberId) ?? []),
      warning,
    ]);
  }
  const approverName = loaded.admins.find((admin) => admin.id === approverId)?.name;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex min-w-0 flex-col gap-4"
      data-slot="task-form"
    >
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}

      {templates.length > 0 ? (
        <FormField
          label="Start from"
          hint="A template sets the type, priority, stages and field defaults. You pick the people, the deadline and the client."
        >
          {(control) => (
            <Select
              value={
                templates.some((option) => option.id === draft.templateId)
                  ? draft.templateId
                  : NO_TEMPLATE
              }
              onValueChange={(value) => {
                const template = templates.find((option) => option.id === value);
                // "No template" keeps what one gave and records none.
                if (template) setDraft((currentDraft) => applyTemplate(currentDraft, template));
                else update({ templateId: "" });
                setErrors({});
              }}
            >
              <SelectTrigger
                id={control.id}
                className="w-full"
                aria-describedby={control["aria-describedby"]}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      ) : null}

      <FormField label="Title" error={errors.title}>
        {(control) => (
          <Input
            {...control}
            name="title"
            value={draft.title}
            maxLength={TITLE_MAX}
            autoComplete="off"
            onChange={(event) => update({ title: event.target.value }, ["title"])}
            required
          />
        )}
      </FormField>

      <div className="flex flex-col gap-4 sm:flex-row">
        <FormField label="Type" error={errors.taskTypeId} className="min-w-0 flex-1">
          {(control) => (
            <Select
              value={type?.id ?? ""}
              onValueChange={(value) =>
                update({ taskTypeId: value }, [
                  "taskTypeId",
                  "eventDate",
                  "eventStart",
                  "eventEnd",
                  "location",
                  "purpose",
                ])
              }
            >
              <SelectTrigger
                id={control.id}
                className="w-full"
                aria-describedby={control["aria-describedby"]}
                aria-invalid={control["aria-invalid"]}
              >
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {types.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Priority" className="min-w-0 flex-1">
          {(control) => (
            <Select
              value={draft.priority}
              onValueChange={(value) => update({ priority: value as Priority })}
            >
              <SelectTrigger
                id={control.id}
                className="w-full"
                aria-describedby={control["aria-describedby"]}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2" data-slot="task-assignees">
        <legend className="mb-1.5 text-sm font-medium">Assign to</legend>
        {draft.assigneeIds.length > 0 ? (
          <ul className="border-border divide-border divide-y rounded-lg border">
            {draft.assigneeIds.map((id) => {
              const person = people.get(id);
              const name = person?.name ?? "Someone";
              const personWarnings = warningsByPerson.get(id) ?? [];
              return (
                <li key={id} data-slot="task-assignee" data-member={id} className="flex flex-col">
                  <div className="flex min-h-14 items-center gap-1 pl-3">
                    <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5">
                      <input
                        type="radio"
                        name="primaryOwner"
                        className="size-4 shrink-0"
                        checked={draft.primaryOwnerId === id}
                        onChange={() => update({ primaryOwnerId: id })}
                        aria-label={`${name} is the primary owner`}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{name}</span>
                        <span className="text-muted-foreground text-xs break-words">
                          {person ? personMeta(person) : ""}
                          {draft.primaryOwnerId === id ? " · Primary owner" : ""}
                        </span>
                      </span>
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      aria-label={`Remove ${name}`}
                      onClick={() => setDraft((currentDraft) => removeAssignee(currentDraft, id))}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </div>
                  {personWarnings.length > 0 ? (
                    <ul className="flex flex-col gap-1 px-3 pb-2.5" data-slot="task-warnings">
                      {personWarnings.map((warning) => (
                        <li
                          key={warning.kind}
                          data-slot="task-warning"
                          data-kind={warning.kind}
                          className="text-attention flex items-start gap-1.5 text-xs"
                        >
                          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                          <span>{warning.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {available.length > 0 ? (
          <Select
            value={ADD_PERSON}
            onValueChange={(id) => {
              setDraft((currentDraft) => addAssignee(currentDraft, id));
              setErrors((currentErrors) => {
                const next = { ...currentErrors };
                delete next.assigneeIds;
                return next;
              });
            }}
          >
            <SelectTrigger
              className="w-full"
              aria-label="Add a person"
              aria-invalid={errors.assigneeIds ? true : undefined}
            >
              <SelectValue placeholder="Add a person" />
            </SelectTrigger>
            <SelectContent>
              {available.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  <span className="flex min-w-0 flex-col">
                    <span>{person.name}</span>
                    <span className="text-muted-foreground text-xs"> · {personMeta(person)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {errors.assigneeIds ? <ErrorText slot="field-error">{errors.assigneeIds}</ErrorText> : null}
        <p className="text-muted-foreground text-xs">
          Pick the primary owner: they mark it done. A freelancer&apos;s coordinator notes it and
          marks it done for them.
        </p>
        {checking ? (
          <p
            className="text-muted-foreground flex items-center gap-1.5 text-xs"
            data-slot="task-checking"
          >
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            Checking their day…
          </p>
        ) : checked?.failed && checked.key === checkKey ? (
          <p className="text-muted-foreground text-xs">
            Their day could not be checked. You can still save.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-4 sm:flex-row">
        <FormField label="Deadline" error={errors.dueDate} className="min-w-0 flex-1">
          {(control) => (
            <Input
              {...control}
              name="dueDate"
              type="date"
              {...(creating ? { min: loaded.today } : {})}
              value={draft.dueDate}
              onChange={(event) => update({ dueDate: event.target.value }, ["dueDate", "dueTime"])}
              required
            />
          )}
        </FormField>
        <FormField label="Time (IST)" error={errors.dueTime} className="min-w-0 sm:w-40">
          {(control) => (
            <Input
              {...control}
              name="dueTime"
              type="time"
              value={draft.dueTime}
              onChange={(event) => update({ dueTime: event.target.value }, ["dueTime", "dueDate"])}
              required
            />
          )}
        </FormField>
      </div>

      {isEvent ? (
        <div className="flex flex-col gap-4" data-slot="task-event-fields">
          <FormField label="Event date" error={errors.eventDate}>
            {(control) => (
              <Input
                {...control}
                name="eventDate"
                type="date"
                value={draft.eventDate}
                onChange={(event) => update({ eventDate: event.target.value }, ["eventDate"])}
                required
              />
            )}
          </FormField>
          <div className="flex gap-4">
            <FormField
              label="Starts"
              hint="Optional"
              error={errors.eventStart}
              className="min-w-0 flex-1"
            >
              {(control) => (
                <Input
                  {...control}
                  name="eventStart"
                  type="time"
                  value={draft.eventStart}
                  onChange={(event) =>
                    update({ eventStart: event.target.value }, ["eventStart", "eventEnd"])
                  }
                />
              )}
            </FormField>
            <FormField
              label="Ends"
              hint="Optional"
              error={errors.eventEnd}
              className="min-w-0 flex-1"
            >
              {(control) => (
                <Input
                  {...control}
                  name="eventEnd"
                  type="time"
                  value={draft.eventEnd}
                  onChange={(event) =>
                    update({ eventEnd: event.target.value }, ["eventEnd", "eventStart"])
                  }
                />
              )}
            </FormField>
          </div>
          {type?.hasLocation ? (
            <FormField label="Location" error={errors.location}>
              {(control) => (
                <Input
                  {...control}
                  name="location"
                  value={draft.location}
                  maxLength={LOCATION_MAX}
                  autoComplete="off"
                  onChange={(event) => update({ location: event.target.value }, ["location"])}
                />
              )}
            </FormField>
          ) : null}
          <FormField label="Purpose" error={errors.purpose}>
            {(control) => (
              <Textarea
                {...control}
                name="purpose"
                rows={2}
                maxLength={PURPOSE_MAX}
                value={draft.purpose}
                onChange={(event) => update({ purpose: event.target.value }, ["purpose"])}
              />
            )}
          </FormField>
        </div>
      ) : null}

      <FormField
        label="Client label"
        hint={`${ROLE_LABELS.staff} see only the client's name and brand basics.`}
      >
        {(control) => (
          <Select value={(clientOffered && draft.clientId) || NO_CLIENT} onValueChange={pickClient}>
            <SelectTrigger
              id={control.id}
              className="w-full"
              aria-describedby={control["aria-describedby"]}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CLIENT}>No client</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      {creating ? (
        loaded.isOwner ? (
          <FormField
            label="Checked first by"
            hint={
              approverName
                ? `${approverName} checks it, then you approve it.`
                : "Nobody: it comes straight to you."
            }
          >
            {(control) => (
              <Select
                value={approverId || OWNER_APPROVES}
                onValueChange={(value) =>
                  update({ approverId: value === OWNER_APPROVES ? "" : value })
                }
              >
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OWNER_APPROVES}>Nobody: you approve it</SelectItem>
                  {loaded.admins.map((admin) => (
                    <SelectItem key={admin.id} value={admin.id}>
                      {admin.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        ) : (
          <p className="text-muted-foreground text-sm" data-slot="task-route">
            You check it when it&apos;s done, then the Owner approves it.
          </p>
        )
      ) : null}

      <FormField
        label="Description"
        hint="Optional. Links to a brief go here."
        error={errors.description}
      >
        {(control) => (
          <Textarea
            {...control}
            name="description"
            rows={3}
            maxLength={DESCRIPTION_MAX}
            value={draft.description}
            onChange={(event) => update({ description: event.target.value }, ["description"])}
          />
        )}
      </FormField>

      {creating ? (
        <fieldset className="flex min-w-0 flex-col gap-2" data-slot="task-stage-fields">
          <legend className="mb-1.5 text-sm font-medium">
            Stages <span className="text-muted-foreground font-normal">(optional)</span>
          </legend>
          {draft.stages.map((stage, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input
                name={`stage-${index}`}
                aria-label={`Stage ${index + 1}`}
                value={stage}
                maxLength={STAGE_NAME_MAX}
                autoComplete="off"
                onChange={(event) => {
                  const value = event.target.value;
                  update(
                    { stages: draft.stages.map((current, at) => (at === index ? value : current)) },
                    ["stages"],
                  );
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label={`Remove stage ${index + 1}`}
                onClick={() =>
                  update({ stages: draft.stages.filter((_, at) => at !== index) }, ["stages"])
                }
              >
                <XIcon aria-hidden />
              </Button>
            </div>
          ))}
          {errors.stages ? <ErrorText slot="field-error">{errors.stages}</ErrorText> : null}
          {draft.stages.length < STAGES_MAX ? (
            <Button
              type="button"
              variant="secondary"
              className="h-11 self-start"
              onClick={() => update({ stages: [...draft.stages, ""] })}
            >
              <PlusIcon aria-hidden />
              Add stage
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      <CustomFieldsForm
        definitions={definitions}
        values={draft.customFields}
        onChange={(customFields) => update({ customFields })}
        errors={customErrors}
        members={loaded.people.map((person) => ({ id: person.id, name: person.name }))}
        disabled={pending}
      />

      {warnings.length > 0 ? (
        <p
          className="text-attention flex items-start gap-1.5 text-sm"
          data-slot="task-warning-summary"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {warnings.length === 1
              ? "1 warning. Saving keeps the person on the task and records that you saw it."
              : `${warnings.length} warnings. Saving keeps the people on the task and records that you saw them.`}
          </span>
        </p>
      ) : null}

      <ActionStatus action={action} />

      <DialogFooter className="sticky bottom-[calc(-1rem-var(--app-safe-bottom))] z-10 md:static">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={checking || (!creating && !dirty)}
          pending={pending}
          pendingLabel={creating ? "Creating…" : "Saving…"}
        >
          {creating ? "Create task" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
