"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import { FieldDefinitionDialog } from "./field-definition-dialog";

/**
 * "Add a field for this client", at the bottom of a client's Edit form (owner's phone walk,
 * 2026-09-30): the Settings dialog with Applies to set to this client. The Owner may switch it to
 * Every client; an Admin, who edits only their own clients, keeps it on this one (global client
 * fields are the Owner's, PERMISSIONS ²). Once saved, the screen's data is fetched again in place,
 * so the new field appears in the open form and what was typed there stays. Settings → Custom
 * fields stays the place to manage fields.
 *
 * The client page composes it into `ClientDetails` (modules never import each other, §3.1).
 */
export function AddClientFieldButton({
  client,
  canGlobal,
}: {
  client: { id: string; name: string };
  canGlobal: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add a field for this client
      </Button>
      {open ? (
        <FieldDefinitionDialog
          entity="client"
          scopes={[client]}
          canGlobal={canGlobal}
          defaultScope={client.id}
          onSaved={() => router.refresh()}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
