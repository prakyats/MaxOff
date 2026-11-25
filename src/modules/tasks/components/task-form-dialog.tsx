"use client";

import { AlertTriangleIcon, ChevronDownIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, Suspense, use, useEffect, useMemo, useRef, useState } from "react";

import type { FieldDefinition } from "@/core/custom-fields";
import { CustomFieldsForm } from "@/core/custom-fields/components/custom-fields-form";
import type { ResultError } from "@/core/errors/result";
import { getInBackground } from "@/core/http/background";
import type { ReminderRule } from "@/core/lib/reminder-rules";
import { ROLE_LABELS } from "@/core/lib/role-labels";
import { cn } from "@/core/lib/utils";
import {
  formatDateTime,
  type ISODate,
  isISODate,
  isISTTime,
  istInstant,
  systemClock,
  toISTDate,
} from "@/core/time";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { ReminderRulesEditor } from "@/core/ui/composites/reminder-rules-editor";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { nameSlide } from "@/core/ui/motion/slide";
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
import { DateInput, TimeInput } from "@/core/ui/primitives/date-time-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { ReorderNameList } from "@/core/ui/reorder/name-list";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";
import { toast } from "sonner";

import { convertRequest } from "../actions/requests";
import { createTask, updateTask } from "../actions/tasks";
import {
  addAssignee,
  assignmentChange,
  chosenType,
  deadlineError,
  type DraftErrors,
  draftChanges,
  draftEventWindow,
  draftFromTask,
  draftOnDate,
  emptyDraft,
  eventDeadline,
  fieldsFromTask,
  followedDeadlineWords,
  followEvent,
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
import {
  chosenLine,
  chosenOwnerLine,
  pickerList,
  pickerRowOf,
  pickerSubtitle,
  type PickerWhen,
} from "../domain/people-picker";
import { taskDefaultReminders } from "../domain/reminders";
import { isFinal } from "../domain/task";
import { taskTypeAsks, taskTypeColor } from "../domain/task-types";
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
import { type PickerCheck, type PickerFace, PeoplePicker, PeopleSheet } from "./people-picker";

/** What the dialog needs, read by the page and handed over as a promise (it opens on a tap). */
export type TaskFormSetup = {
  viewerId: string;
  isOwner: boolean;
  today: ISODate;
  /** `org_settings.workload_warning_threshold` (kickoff 4 decision 11). */
  threshold: number;
  types: TaskType[];
  /** Active Admins, Staff and freelancers, and the Owner (6b.2, owner 2026-10-07). */
  people: AssignablePerson[];
  /** The Owner: every client not closed; an Admin: their own (kickoff 4 decision 2). */
  clients: ClientOption[];
  /** The Owner's approver choices: every active Admin (kickoff 4 decision 3). */
  admins: AdminOption[];
  /** Task custom fields, company-wide and per type, archived included. */
  definitions: FieldDefinition[];
  /** The active task templates, for "Start from" (4.6; shared company-wide, decision 19). */
  templates: TaskTemplate[];
  /**
   * Every template's own reminders, archived ones included, by id (5.3): a task follows its
   * template's while it has none of its own, so the dialog names them as "the default".
   */
  templateReminders: Record<string, ReminderRule[]>;
  /** The organisation's default reminders (Settings → Thresholds; `[]` = the launch schedule). */
  orgReminders: ReminderRule[];
};

export type TaskFormMode =
  /** `date`: started on a calendar day, the deadline (or the event) on it (6.4b). */
  | { kind: "create"; date?: ISODate | undefined }
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

/**
 * Create or edit a task (4.3; PRODUCT §4.6, WORKFLOWS §3.1, kickoff 4 decisions 1–4, 11–15,
 * ADR-0013; **type first since v6.0**, the owner-approved samples of 13 and 14 Nov 2026). A bottom
 * sheet on a phone, a dialog from `md` up (§14.1), with the commit sticky at the sheet's foot.
 *
 * **The type is asked first** and decides the rest, from the type's data alone: an event asks
 * When / From / To, Where when the type has a location, and its deadline follows the end of the
 * event ("Done by … · the end of the event", Change to set it by hand); anything else asks one
 * deadline. A new task asks nothing else until a type is chosen.
 *
 * **Who's on it?** lists everyone at the task's time: on a phone a sheet over the form, on a
 * laptop the dialog's right-hand column (`people-picker.tsx`). The people picked get their
 * warnings (workload, overlap, leave) as soon as the deadline or the event is set, from the same
 * `member_availability()` answer the list is drawn from; the ones kept are recorded as overridden
 * when the task is saved. Never blocking.
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
    if (mode.kind === "create" && mode.date) return draftOnDate(mode.date, systemClock());
    return emptyDraft();
  });
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const busy = useRef(false);
  // Set while a save backs the layer out, so the close it causes asks nothing.
  const leaving = useRef(false);
  const dirty = isDraftDirty(initial, draft);
  const creating = mode.kind !== "edit";
  // With a type the form has its people beside it from `md` up, so the dialog is wider.
  const typed = draft.taskTypeId !== "";

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
        <DialogContent
          className={typed ? "md:max-w-4xl" : "md:max-w-xl"}
          data-slot="task-form-dialog"
        >
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
          <Suspense fallback={<FormSkeleton typed={typed} />}>
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
        destructive
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

/** A field's tracing: its label's line and its control, at the control's height on each width. */
function FieldSkeleton({ className, trace }: { className?: string; trace?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="h-11 w-full md:h-8" data-trace={trace} />
    </div>
  );
}

/**
 * The form's tracing while the setup loads (§14.1). A new task opens on its first state, **Type
 * first**: the Type field with its hint, the dimmed Title under it, the two buttons. A task being
 * edited, or a new one whose type is already chosen (the setup read again after "Keep editing"),
 * traces the full form: Type, Title, the date row, the client, the people, and from `md` up the
 * "Who's on it?" column beside them.
 */
function FormSkeleton({ typed }: { typed: boolean }) {
  // The form's own foot: a band across the sheet on a phone, a ruled row on a laptop.
  const footer = (
    <div className="bg-popover -mx-4 -mb-[calc(1rem+var(--app-safe-bottom))] flex flex-col-reverse gap-2 border-t p-4 pb-[calc(1rem+var(--app-safe-bottom))] md:-mb-4 md:flex-row md:justify-end md:px-4 md:py-3">
      <Skeleton className="h-11 w-full md:h-8 md:w-20" data-trace="cancel" />
      <Skeleton className="h-11 w-full md:h-8 md:w-28" data-trace="submit" />
    </div>
  );
  if (!typed) {
    return (
      <div aria-hidden className="flex flex-col gap-4" data-slot="task-form-skeleton">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="h-11 w-full md:h-8" data-trace="type" />
          {/* The hint's line box (`text-xs`, 16px), so the Title under it does not move. */}
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <FieldSkeleton className="opacity-65" trace="title" />
        {footer}
      </div>
    );
  }
  return (
    <div aria-hidden className="flex flex-col gap-4" data-slot="task-form-skeleton">
      <div className="grid min-w-0 gap-4 md:grid-cols-2 md:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <FieldSkeleton />
          <FieldSkeleton />
          <div className="flex flex-col gap-4 sm:flex-row">
            <FieldSkeleton className="flex-1" />
            <FieldSkeleton className="sm:w-40" />
          </div>
          <FieldSkeleton />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-11 w-40 rounded-full md:h-8" />
          </div>
        </div>
        <div className="border-border hidden min-w-0 flex-col gap-2 border-l pl-6 md:flex">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-8 w-full" />
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-11 w-full" />
          ))}
        </div>
      </div>
      {footer}
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
  reminderRules: "reminders",
};

function personMeta(person: AssignablePerson): string {
  if (person.engagement === "freelance") {
    return person.coordinatorName ? `Freelancer · with ${person.coordinatorName}` : "Freelancer";
  }
  return person.jobTitle ?? ROLE_LABELS[person.role];
}

/** A type as the Type field shows it: its colour's dot and its name. */
function TypeName({ type }: { type: TaskType }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: taskTypeColor(type.color) }}
      />
      <span className="truncate">{type.name}</span>
    </span>
  );
}

/** The word beside a chosen person's name: green for Free, amber for a clash or leave. */
function statusTone(short: string): string {
  if (short === "Free") return "text-success";
  if (short.includes("Clashes") || short.includes("On leave")) return "text-attention";
  return "text-muted-foreground";
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
  const desktop = useIsDesktop();
  const [errors, setErrors] = useState<DraftErrors>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<ResultError | null>(null);
  // The phone's "Who's on it?" sheet; the laptop's list is always beside the form.
  const [picking, setPicking] = useState(false);
  // "Change" on the Done by line shows the deadline's own fields.
  const [changingDeadline, setChangingDeadline] = useState(false);
  const search = useRef<HTMLInputElement | null>(null);
  const creating = mode.kind !== "edit";

  const type = loaded ? chosenType(draft, loaded.types) : null;
  const isEvent = type?.kind === "event";
  const dueDay = type && isISODate(draft.dueDate) ? draft.dueDate : null;
  const eventDay = isEvent && isISODate(draft.eventDate) ? draft.eventDate : null;
  const days = availabilityDays(dueDay, eventDay);
  const daysKey = days.join(",");
  const needsCheck = days.length > 0;
  const [checked, setChecked] = useState<{
    key: string;
    rows: AvailabilityDay[];
    failed: boolean;
  } | null>(null);
  const checking = needsCheck && checked?.key !== daysKey;

  // One availability read per set of days, for everyone (v6.0): "Who's on it?" lists them as
  // Free then / Busy then and the warnings about the people picked come from the same answer,
  // so picking someone asks nothing more. Again whenever the deadline's day or the event's moves.
  useEffect(() => {
    if (!needsCheck) return;
    let live = true;
    // A plain request, never a server action (ARCHITECTURE §4.4): it goes out on a timer.
    const timer = setTimeout(() => {
      void getInBackground<AvailabilityDay[]>("/api/tasks/availability", {
        everyone: "1",
        day: daysKey.split(","),
      }).then((result) => {
        if (!live) return;
        setChecked({ key: daysKey, rows: result.ok ? result.data : [], failed: !result.ok });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [daysKey, needsCheck]);

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

  const answered = needsCheck && checked?.key === daysKey ? checked : null;
  const window = draftEventWindow(draft, type);
  const warnings: AssignmentWarning[] =
    loaded && answered && draft.assigneeIds.length > 0
      ? assignmentWarnings({
          memberIds: draft.assigneeIds,
          dueDate: dueDay,
          eventDate: eventDay,
          eventWindow: window,
          threshold: loaded.threshold,
          availability: answered.rows,
          current,
        })
      : [];

  // What the people are picked for: the event's day and time, else the deadline's day.
  const when: PickerWhen | null = !type
    ? null
    : isEvent
      ? eventDay
        ? { kind: "event", date: eventDay, window }
        : null
      : dueDay
        ? { kind: "deadline", date: dueDay }
        : null;
  const pickerPeople = loaded?.people;
  const viewerId = loaded?.viewerId ?? "";
  const list = useMemo(
    () =>
      pickerList({
        people: pickerPeople ?? [],
        when,
        availability: answered && !answered.failed ? answered.rows : null,
        viewerId,
        ownerId: pickerPeople?.find((person) => person.role === "owner")?.id ?? null,
        current,
      }),
    // `when` is rebuilt every render: its parts are what the list depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when's parts, listed
    [
      pickerPeople,
      when?.kind,
      when?.date,
      window?.startAt,
      window?.endAt,
      answered,
      viewerId,
      current,
    ],
  );
  const faces = useMemo(
    () =>
      new Map<string, PickerFace>(
        (pickerPeople ?? []).map((person) => [person.id, { meta: personMeta(person) }]),
      ),
    [pickerPeople],
  );

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
  // In Settings → Task types' order; an archived type only for the task that still has it.
  const types = loaded.types.filter((option) => !option.archived || option.id === draft.taskTypeId);
  // A suggestion's client may have closed since (a label is Active or Paused, decision 22).
  const clientOffered = draft.clientId === "" || clients.some((c) => c.id === draft.clientId);
  const templates = creating ? loaded.templates : [];
  const definitions = loaded.definitions.filter(
    (definition) => definition.taskTypeId === null || definition.taskTypeId === type?.id,
  );
  // An approver no longer offered (a suggestion's client Admin who left since) is nobody's pick.
  const approverId = loaded.admins.some((admin) => admin.id === draft.approverId)
    ? draft.approverId
    : "";

  /** Every change to the draft: an event's deadline follows it while it is not set by hand. */
  function change(next: (currentDraft: TaskDraft) => TaskDraft) {
    setDraft((currentDraft) => {
      const changed = next(currentDraft);
      return followEvent(changed, chosenType(changed, loaded?.types ?? []), systemClock());
    });
  }

  function clearErrors(keys: readonly (keyof DraftErrors)[]) {
    if (keys.length === 0) return;
    setErrors((currentErrors) => {
      const next = { ...currentErrors };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function update(patch: Partial<TaskDraft>, clear: (keyof DraftErrors)[] = []) {
    change((currentDraft) => ({ ...currentDraft, ...patch }));
    clearErrors(clear);
    setFormError(null);
  }

  // The create function refuses a deadline not later than now (kickoff 4 decision 4): say so as
  // it is picked, not after the whole form is filled in. Set by hand, an event's deadline stops
  // following the event.
  function pickDeadline(patch: Pick<Partial<TaskDraft>, "dueDate" | "dueTime">) {
    update({ ...patch, dueFollowsEvent: false }, ["dueDate", "dueTime"]);
    const deadline = deadlineError(
      { dueDate: draft.dueDate, dueTime: draft.dueTime, ...patch },
      { creating, now: systemClock() },
    );
    if (deadline) setErrors((currentErrors) => ({ ...currentErrors, dueDate: deadline }));
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

  function togglePerson(memberId: string, on: boolean) {
    change((currentDraft) =>
      on ? addAssignee(currentDraft, memberId) : removeAssignee(currentDraft, memberId),
    );
    clearErrors(["assigneeIds"]);
    setFormError(null);
  }

  // A phone opens the sheet; a laptop's list is already beside the form, so the tap goes to its
  // search. Read at the tap (`useIsDesktop`).
  function openPicker() {
    if (desktop) search.current?.focus();
    else setPicking(true);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded) return;
    const found = validateDraft(draft, type, { creating, now: systemClock() });
    setErrors(found);
    setCustomErrors({});
    if (!type || Object.keys(found).length > 0 || savingWaits) return;
    action.run();
  }

  async function send() {
    if (!loaded || !type) return;
    const found = validateDraft(draft, type, { creating, now: systemClock() });
    if (Object.keys(found).length > 0 || savingWaits) {
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
    const warningInput = (rows: AssignmentWarning[]) =>
      rows.map((warning) => ({
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
        closeOverlaysThen(() => {
          nameSlide("forward");
          router.push(href, { transitionTypes: [NAV_FORWARD] });
        });
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

  // Saving waits for a check in flight when there is someone to warn about (4B).
  const savingWaits = checking && draft.assigneeIds.length > 0;
  const summary = formError ? describeError(formError) : null;
  const approverName = loaded.admins.find((admin) => admin.id === approverId)?.name;
  // "Using the default" (5.3): the template the task started from, else its type, else the
  // organisation, else the launch schedule, as `app.task_reminder_rules` resolves it when armed.
  const reminderTemplateId = mode.kind === "edit" ? mode.task.templateId : draft.templateId;
  const defaultReminders = taskDefaultReminders({
    template: reminderTemplateId ? (loaded.templateReminders[reminderTemplateId] ?? null) : null,
    type: type?.defaultReminders ?? null,
    organisation: loaded.orgReminders,
  });

  // L9: a refused field under "More options" opens it, so the message is never hidden.
  const moreHasError =
    Object.keys(customErrors).length > 0 ||
    (["reminders", "purpose", "description", "stages"] as const).some((key) =>
      Boolean(errors[key]),
    );

  const nameOf = (id: string) => people.get(id)?.name ?? "Someone";
  const chosenNames = draft.assigneeIds.map(nameOf);
  const primaryName = draft.primaryOwnerId ? nameOf(draft.primaryOwnerId) : null;
  const subtitle = type
    ? pickerSubtitle({
        typeName: type.name,
        event: isEvent,
        when,
        dueAt: dueDay && isISTTime(draft.dueTime) ? istInstant(dueDay, draft.dueTime) : null,
      })
    : "";
  const check: PickerCheck = !when
    ? "idle"
    : checking
      ? "checking"
      : answered?.failed
        ? "failed"
        : "ready";
  const picker = (
    <PeoplePicker
      list={list}
      chosen={draft.assigneeIds}
      faces={faces}
      check={check}
      onToggle={togglePerson}
      searchRef={search}
      className="flex-1"
    />
  );

  // An event's deadline: the end of the event until it is set by hand (v6.0).
  const followed = isEvent && draft.dueFollowsEvent ? eventDeadline(draft, systemClock()) : null;
  const deadlineSet = isISODate(draft.dueDate) && isISTTime(draft.dueTime);
  const showDeadline =
    !isEvent ||
    !draft.dueFollowsEvent ||
    changingDeadline ||
    Boolean(errors.dueDate) ||
    Boolean(errors.dueTime);

  const deadlineFields = (
    <div className="flex flex-col gap-4 sm:flex-row" data-slot="task-deadline-fields">
      <FormField label="Deadline" error={errors.dueDate} className="min-w-0 flex-1">
        {(control) => (
          <DateInput
            {...control}
            name="dueDate"
            {...(creating ? { min: loaded.today } : {})}
            value={draft.dueDate}
            onChange={(event) => pickDeadline({ dueDate: event.target.value })}
            required
          />
        )}
      </FormField>
      <FormField label="Time (IST)" error={errors.dueTime} className="min-w-0 sm:w-40">
        {(control) => (
          <TimeInput
            {...control}
            name="dueTime"
            value={draft.dueTime}
            onChange={(event) => pickDeadline({ dueTime: event.target.value })}
            required
          />
        )}
      </FormField>
    </div>
  );

  const clientField = (
    <FormField
      label="Client (label)"
      hint={`${ROLE_LABELS.staff} see only the client's name and brand basics.`}
      className="min-w-0 flex-1"
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
  );

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

      <div className={cn("grid min-w-0 gap-4", type && "md:grid-cols-2 md:gap-6")}>
        <div className="flex min-w-0 flex-col gap-4" data-slot="task-fields">
          <FormField
            label="Type"
            error={errors.taskTypeId}
            hint={type ? undefined : "First, so the form asks only what this kind of task needs."}
          >
            {(control) => (
              <Select
                value={type?.id ?? ""}
                onValueChange={(value) =>
                  update({ taskTypeId: value }, [
                    "taskTypeId",
                    "dueDate",
                    "dueTime",
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
                  data-field="task-type"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                >
                  <SelectValue placeholder="Choose a type">
                    {type ? <TypeName type={type} /> : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {types.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      // The name at the row's start, what the type asks for at its end.
                      className="*:[span]:last:min-w-0 *:[span]:last:flex-1"
                    >
                      <span
                        className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3"
                        data-slot="task-type-option"
                      >
                        <TypeName type={option} />
                        <span className="text-muted-foreground text-xs" data-slot="task-type-asks">
                          {taskTypeAsks(option)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                  <p
                    className="text-muted-foreground border-border mt-1 border-t px-2 pt-2 pb-1 text-xs"
                    data-slot="task-type-note"
                  >
                    Types come from Settings → Task types. A new type shows here by itself.
                  </p>
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label="Title" error={errors.title} className={type ? "" : "opacity-65"}>
            {(control) => (
              <Input
                {...control}
                name="title"
                value={draft.title}
                maxLength={TITLE_MAX}
                autoComplete="off"
                onChange={(event) => update({ title: event.target.value }, ["title"])}
                // Nothing else is asked until the type is chosen (v6.0, type first).
                disabled={!type}
                required
              />
            )}
          </FormField>

          {type && isEvent ? (
            <>
              <div
                className="grid grid-cols-2 gap-4 sm:grid-cols-[1.4fr_1fr_1fr]"
                data-slot="task-event-fields"
              >
                <FormField
                  label="When"
                  error={errors.eventDate}
                  className="col-span-2 min-w-0 sm:col-span-1"
                >
                  {(control) => (
                    <DateInput
                      {...control}
                      name="eventDate"
                      value={draft.eventDate}
                      onChange={(event) => update({ eventDate: event.target.value }, ["eventDate"])}
                      required
                    />
                  )}
                </FormField>
                <FormField label="From" error={errors.eventStart} className="min-w-0">
                  {(control) => (
                    <TimeInput
                      {...control}
                      name="eventStart"
                      value={draft.eventStart}
                      onChange={(event) =>
                        update({ eventStart: event.target.value }, ["eventStart", "eventEnd"])
                      }
                    />
                  )}
                </FormField>
                <FormField label="To" error={errors.eventEnd} className="min-w-0">
                  {(control) => (
                    <TimeInput
                      {...control}
                      name="eventEnd"
                      value={draft.eventEnd}
                      onChange={(event) =>
                        update({ eventEnd: event.target.value }, ["eventEnd", "eventStart"])
                      }
                    />
                  )}
                </FormField>
              </div>
              <div className="flex flex-col gap-4 sm:flex-row">
                {type.hasLocation ? (
                  <FormField label="Where" error={errors.location} className="min-w-0 flex-1">
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
                {clientField}
              </div>
            </>
          ) : null}

          {type && !isEvent ? (
            <>
              {deadlineFields}
              {clientField}
            </>
          ) : null}

          {type ? (
            <fieldset className="flex min-w-0 flex-col gap-3" data-slot="task-assignees">
              <legend className="mb-1.5 text-sm font-medium">Who&apos;s on it?</legend>
              <ul className="flex min-w-0 flex-wrap items-center gap-2">
                {draft.assigneeIds.map((id) => {
                  const name = nameOf(id);
                  const short = check === "ready" ? (pickerRowOf(list, id)?.short ?? "") : "";
                  return (
                    <li
                      key={id}
                      data-slot="task-assignee"
                      data-member={id}
                      data-primary={draft.primaryOwnerId === id ? "" : undefined}
                      className="border-control-border flex max-w-full min-w-0 items-center gap-1.5 rounded-full border py-0.5 pr-0.5 pl-3"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
                      {draft.primaryOwnerId === id && draft.assigneeIds.length > 1 ? (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          Primary owner
                        </span>
                      ) : null}
                      {short ? (
                        <span
                          className={cn("shrink-0 text-xs", statusTone(short))}
                          data-slot="task-assignee-status"
                        >
                          {short}
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 rounded-full md:size-7"
                        aria-label={`Remove ${name}`}
                        onClick={() => togglePerson(id, false)}
                      >
                        <XIcon aria-hidden />
                      </Button>
                    </li>
                  );
                })}
                <li className="flex">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-11 rounded-full border-dashed px-3 md:h-8"
                    aria-invalid={errors.assigneeIds ? true : undefined}
                    aria-haspopup={desktop ? undefined : "dialog"}
                    data-slot="add-person"
                    onClick={openPicker}
                  >
                    <PlusIcon aria-hidden />
                    Add a person
                  </Button>
                </li>
              </ul>
              {errors.assigneeIds ? (
                <ErrorText slot="field-error">{errors.assigneeIds}</ErrorText>
              ) : null}
              {draft.assigneeIds.length > 1 ? (
                <FormField label="Primary owner" hint="Marks it done.">
                  {(control) => (
                    <Select
                      value={draft.primaryOwnerId}
                      onValueChange={(value) => update({ primaryOwnerId: value })}
                    >
                      <SelectTrigger
                        id={control.id}
                        className="w-full"
                        aria-describedby={control["aria-describedby"]}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {draft.assigneeIds.map((id) => (
                          <SelectItem key={id} value={id}>
                            {nameOf(id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              ) : (
                // PP-forms-6: one short line; the freelancer's coordinator rule is in the guide.
                <p className="text-muted-foreground text-xs" data-slot="assign-hint">
                  The primary owner marks it done.
                </p>
              )}
              {warnings.length > 0 ? (
                <ul className="flex flex-col gap-1" data-slot="task-warnings">
                  {warnings.map((warning) => (
                    <li
                      key={`${warning.memberId}-${warning.kind}`}
                      data-slot="task-warning"
                      data-kind={warning.kind}
                      data-member={warning.memberId}
                      className="text-attention flex items-start gap-1.5 text-xs"
                    >
                      <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                      <span>
                        <span className="font-medium">{nameOf(warning.memberId)}:</span>{" "}
                        {warning.text}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {draft.assigneeIds.length === 0 ? null : checking ? (
                <p
                  className="text-muted-foreground flex items-center gap-1.5 text-xs"
                  data-slot="task-checking"
                >
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                  Checking their day…
                </p>
              ) : answered?.failed ? (
                <p className="text-muted-foreground text-xs" data-slot="task-check-failed">
                  Their day could not be checked. You can still save.
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {type && isEvent ? (
            <>
              <div
                className="border-border bg-muted/40 rounded-card flex items-center justify-between gap-3 border px-3 py-2"
                data-slot="task-done-by"
                data-follows={draft.dueFollowsEvent ? "" : undefined}
              >
                <p className="min-w-0 text-sm">
                  Done by{" "}
                  {followed ? (
                    <>
                      <span className="font-semibold">
                        {formatDateTime(istInstant(followed.date, followed.time), "EEE d MMM")}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        · {followedDeadlineWords(followed.from, type.name)}
                      </span>
                    </>
                  ) : draft.dueFollowsEvent ? (
                    <span className="text-muted-foreground">
                      {followedDeadlineWords("end", type.name)}, once When is set
                    </span>
                  ) : deadlineSet ? (
                    <span className="font-semibold">
                      {formatDateTime(istInstant(draft.dueDate, draft.dueTime), "EEE d MMM")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">the deadline you set below</span>
                  )}
                </p>
                {showDeadline ? null : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-11 shrink-0 md:h-8"
                    onClick={() => setChangingDeadline(true)}
                  >
                    Change
                  </Button>
                )}
              </div>
              {showDeadline ? deadlineFields : null}
            </>
          ) : null}

          {type ? (
            <MoreOptions collapsible={creating} forceOpen={moreHasError}>
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
                        if (template) {
                          change((currentDraft) => applyTemplate(currentDraft, template));
                        } else update({ templateId: "" });
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

              <FormField label="Priority">
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

              <ReminderRulesEditor
                draft={draft.reminders}
                onChange={(reminders) => update({ reminders }, ["reminders"])}
                fallback={defaultReminders}
                disabled={pending}
                error={errors.reminders}
              />

              {isEvent ? (
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
              ) : null}

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
                    onChange={(event) =>
                      update({ description: event.target.value }, ["description"])
                    }
                  />
                )}
              </FormField>

              {creating ? (
                <fieldset className="flex min-w-0 flex-col gap-2" data-slot="task-stage-fields">
                  <legend className="mb-1.5 text-sm font-medium">
                    Stages <span className="text-muted-foreground font-normal">(optional)</span>
                  </legend>
                  <ReorderNameList
                    names={draft.stages}
                    onChange={(stages) => update({ stages }, ["stages"])}
                    label="Stages"
                    itemLabel={(index) => `Stage ${index + 1}`}
                    removeLabel="Remove stage"
                    namePrefix="stage"
                    maxLength={STAGE_NAME_MAX}
                    slot="task-stage-field"
                  />
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
            </MoreOptions>
          ) : null}
        </div>

        {type && desktop ? (
          <section
            aria-label="Who's on it?"
            data-slot="people-column"
            className="border-border flex min-w-0 flex-col gap-2 border-l pl-6 md:sticky md:top-0 md:h-[min(34rem,calc(100dvh-15rem))] md:self-start"
          >
            <div className="flex shrink-0 flex-col gap-0.5">
              <h3 className="text-sm font-medium">Who&apos;s on it?</h3>
              <p className="text-muted-foreground text-xs" data-slot="people-subtitle">
                {subtitle}
              </p>
            </div>
            {picker}
            {isEvent ? (
              <p className="text-muted-foreground shrink-0 text-xs" data-slot="people-follow-note">
                The list follows the date and time: change them and who&apos;s free changes with
                them.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      {type && !desktop ? (
        <PeopleSheet
          open={picking}
          onClose={() => setPicking(false)}
          subtitle={subtitle}
          chosenWords={chosenLine(chosenNames)}
        >
          {picker}
        </PeopleSheet>
      ) : null}

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

      {/* Pinned on a laptop too since v6.0: with the people beside it the form is taller. */}
      <DialogFooter className="md:bg-popover sticky bottom-[calc(-1rem-var(--app-safe-bottom))] z-10 md:-mx-4 md:-mb-4 md:items-center md:border-t md:px-4 md:py-3">
        {type ? (
          <p
            className="text-muted-foreground min-w-0 truncate text-sm max-md:hidden md:mr-auto"
            data-slot="task-chosen"
          >
            {chosenOwnerLine(draft.assigneeIds.length, primaryName)}
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={pending}
          data-dismiss=""
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={!type || savingWaits || (!creating && !dirty)}
          pending={pending}
          pendingLabel={creating ? "Creating…" : "Saving…"}
        >
          {creating ? "Create task" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * L9 (v1.8 V4), as it stands since v6.0 (type first): a new task asks its type, title, dates,
 * client and people in the open; the rest (Start from, priority, reminders, an event's purpose,
 * who checks it, the description, stages and custom fields) sits under "More options", a native
 * `<details>` (a view control: no history, §14.2 d). Its fields stay in the form while closed,
 * with their defaults (Medium, the default reminders). It opens by itself when one of its fields
 * is refused. Editing a task shows every field, as before.
 */
function MoreOptions({
  collapsible,
  forceOpen,
  children,
}: {
  collapsible: boolean;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!collapsible) return <>{children}</>;
  return (
    <details
      data-slot="task-more-options"
      open={open || forceOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group/more border-border rounded-card border"
    >
      <summary className="pressable-row focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-col py-2">
          More options
          <span className="text-muted-foreground text-xs font-normal">
            Template, priority, reminders, description, stages
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open/more:rotate-180"
        />
      </summary>
      <div className="border-border flex min-w-0 flex-col gap-4 border-t px-3 pt-3 pb-3">
        {children}
      </div>
    </details>
  );
}
