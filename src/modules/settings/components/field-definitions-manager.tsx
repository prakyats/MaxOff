"use client";

import { ArchiveIcon, ArchiveRestoreIcon, ListPlusIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import {
  ENTITY_LABELS,
  FIELD_TYPE_LABELS,
  type FieldDefinition,
  SCOPE_WORDS,
  scopeIdOf,
  scopeKindOf,
  type SettingsEntity,
  splitDefinitions,
} from "@/core/custom-fields";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Badge } from "@/core/ui/primitives/badge";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { setFieldDefinitionArchived } from "../actions/custom-fields";
import { FieldDefinitionDialog, type ScopeOption } from "./field-definition-dialog";
import { ListItemActionsSheet } from "./list-item-actions-sheet";

/**
 * Settings → Custom fields for one entity (3.2, PRODUCT §4.16): the live definitions grouped by
 * scope ("Every client", then one group per client), Add, Edit, Archive and Restore. Global
 * rows are the Owner's; an Admin sees them read-only and edits only the rows scoped to their
 * own clients (PERMISSIONS ²). Task fields (4C) group the same way by task type ("Every task",
 * then a group per type that has fields), all `lists.manage`'s. The database decides again on
 * every write.
 *
 * Rows follow the list-manager shape (1.4): on a phone the row keeps the name and a ⋯ sheet with
 * Edit and Archive; from `md` up both buttons sit on the row.
 */
export function FieldDefinitionsManager({
  entity,
  definitions,
  scopes,
  canGlobal,
}: {
  entity: SettingsEntity;
  definitions: readonly FieldDefinition[];
  scopes: readonly ScopeOption[];
  canGlobal: boolean;
}) {
  const [adding, setAdding] = useState<{ scope: string | null } | null>(null);
  const [editing, setEditing] = useState<FieldDefinition | null>(null);
  const [archiving, setArchiving] = useState<FieldDefinition | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const kind = scopeKindOf(entity);
  const scoped = kind !== null;
  const { active, archived } = splitDefinitions(definitions);
  const labels = ENTITY_LABELS[entity];
  const scopeName = new Map(scopes.map((scope) => [scope.id, scope.name]));
  const canAdd = canGlobal || (scoped && scopes.length > 0);

  // A group per scope, "Every client" first, then the clients in name order (a task type's in
  // the Owner's order, and only once it has a field: seven empty groups say nothing).
  const groups: Array<{
    scope: string | null;
    title: string;
    fields: FieldDefinition[];
    canAddHere: boolean;
  }> = [];
  if (canGlobal || active.some((d) => scopeIdOf(d) === null)) {
    groups.push({
      scope: null,
      title: kind ? SCOPE_WORDS[kind].every : `All ${labels.plural.toLowerCase()}`,
      fields: active.filter((d) => scopeIdOf(d) === null),
      canAddHere: canGlobal,
    });
  }
  if (kind) {
    for (const scope of scopes) {
      const fields = active.filter((d) => scopeIdOf(d) === scope.id);
      if (fields.length > 0 || (kind === "client" && scopes.length <= 12)) {
        groups.push({
          scope: scope.id,
          title: scope.archived ? `${scope.name} only (archived type)` : `${scope.name} only`,
          fields,
          canAddHere: !scope.archived,
        });
      }
    }
    for (const field of active) {
      const id = scopeIdOf(field);
      if (id && !scopeName.has(id)) {
        groups.push({
          scope: id,
          title: SCOPE_WORDS[kind].another,
          fields: [field],
          canAddHere: false,
        });
      }
    }
  }

  const editable = (definition: FieldDefinition) => {
    const id = scopeIdOf(definition);
    return canGlobal || (id !== null && scopeName.has(id));
  };

  async function restore(definition: FieldDefinition) {
    setBusyId(definition.id);
    toastResult(
      await setFieldDefinitionArchived({ definitionId: definition.id, archived: false }),
      {
        success: "Field restored",
      },
    );
    setBusyId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 ? (
        <EmptyState
          icon={ListPlusIcon}
          title={`No ${labels.singular.toLowerCase()} fields yet`}
          description={
            canAdd
              ? `Add one and it appears on every ${labels.singular.toLowerCase()} form.`
              : `The Owner defines these fields.`
          }
          action={
            canAdd ? (
              <Button variant="strong" onClick={() => setAdding({ scope: null })}>
                <PlusIcon aria-hidden />
                Add field
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {groups.map((group) =>
        group.fields.length === 0 && active.length === 0 ? null : (
          <section key={group.scope ?? "_"} className="flex flex-col gap-2" data-slot="field-group">
            <div className="flex min-h-9 items-center justify-between gap-2">
              <h2 className="text-muted-foreground text-sm font-medium">{group.title}</h2>
              {group.canAddHere && active.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdding({ scope: group.scope })}
                  aria-label={`Add a field for ${group.title.toLowerCase()}`}
                >
                  <PlusIcon aria-hidden />
                  Add
                </Button>
              ) : null}
            </div>
            {group.fields.length === 0 ? (
              <p className="text-muted-foreground px-1 text-sm">No fields here yet.</p>
            ) : (
              <ul
                data-slot="field-definitions"
                className="border-border divide-border divide-y rounded-lg border"
              >
                {group.fields.map((definition) => (
                  <li
                    key={definition.id}
                    data-slot="field-definition"
                    data-key={definition.key}
                    className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
                  >
                    <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                      <span className="truncate text-sm font-medium">
                        {definition.label}
                        {definition.required ? <span aria-label="required"> *</span> : null}
                      </span>
                      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                        <Badge variant="outline" className="font-normal">
                          {FIELD_TYPE_LABELS[definition.type]}
                        </Badge>
                        <span className="font-mono">{definition.key}</span>
                        {definition.section ? <span>· {definition.section}</span> : null}
                      </span>
                    </div>
                    {editable(definition) ? (
                      <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${definition.label}`}
                          onClick={() => setEditing(definition)}
                          className="hidden md:inline-flex"
                        >
                          <PencilIcon aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          aria-label={`Archive ${definition.label}`}
                          onClick={() => setArchiving(definition)}
                          className="hidden md:inline-flex"
                        >
                          <ArchiveIcon aria-hidden />
                        </Button>
                        <ListItemActionsSheet
                          item={{ name: definition.label }}
                          label="Field"
                          renameLabel="Edit"
                          onRename={() => setEditing(definition)}
                          onArchive={() => setArchiving(definition)}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ),
      )}

      {archived.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">Archived fields</h2>
          <p className="text-muted-foreground text-sm">
            Hidden from forms. Values already entered are kept and shown read-only.
          </p>
          <ul
            data-slot="archived-field-definitions"
            className="border-border divide-border divide-y rounded-lg border"
          >
            {archived.map((definition) => (
              <li
                key={definition.id}
                data-slot="archived-field-definition"
                data-key={definition.key}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <span className={cn("text-muted-foreground truncate text-sm", CARD_ROW_TITLE)}>
                  {definition.label}
                  {scopeIdOf(definition) ? (
                    <span className="text-xs">
                      {" "}
                      ·{" "}
                      {scopeName.get(scopeIdOf(definition) ?? "") ??
                        (kind === "task_type" ? "one task type" : "one client")}
                    </span>
                  ) : null}
                </span>
                {editable(definition) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={CARD_ROW_TRAILING}
                    disabled={busyId !== null}
                    onClick={() => void restore(definition)}
                  >
                    <ArchiveRestoreIcon aria-hidden />
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {adding ? (
        <FieldDefinitionDialog
          key="add"
          entity={entity}
          scopes={scopes}
          canGlobal={canGlobal}
          defaultScope={adding.scope}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {editing ? (
        <FieldDefinitionDialog
          key={editing.id}
          entity={entity}
          definition={editing}
          scopes={scopes}
          canGlobal={canGlobal}
          defaultScope={scopeIdOf(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          title={`Archive ${archiving.label}?`}
          description="It leaves the forms. Values already entered are kept and shown read-only, and you can restore it later."
          confirmLabel={`Archive ${archiving.label}`}
          onConfirm={async () => {
            toastResult(
              await setFieldDefinitionArchived({ definitionId: archiving.id, archived: true }),
              {
                success: "Field archived",
              },
            );
            setArchiving(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The screen's one primary action, for `PageHeader` (a FAB on a phone). */
export function AddFieldButton({
  entity,
  scopes,
  canGlobal,
}: {
  entity: SettingsEntity;
  scopes: readonly ScopeOption[];
  canGlobal: boolean;
}) {
  const [open, setOpen] = useState(false);
  const scoped = scopeKindOf(entity) !== null;
  if (!canGlobal && !(scoped && scopes.length > 0)) return null;
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add field
      </Button>
      {open ? (
        <FieldDefinitionDialog
          entity={entity}
          scopes={scopes}
          canGlobal={canGlobal}
          defaultScope={null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
