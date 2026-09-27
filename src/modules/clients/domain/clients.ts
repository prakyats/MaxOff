import type { Enums } from "@/core/db";

import type { BrandColor, BrandFont } from "./schemas";

export type ClientState = Enums<"client_state">;

export const CLIENT_STATES = [
  "draft",
  "active",
  "paused",
  "inactive",
] as const satisfies readonly ClientState[];

export const CLIENT_STATE_LABELS: Record<ClientState, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  inactive: "Inactive",
};

/** What a state means for the people who open the client (PRODUCT §4.4, shown in its banner). */
export const CLIENT_STATE_NOTES: Record<ClientState, string> = {
  draft: "Not active yet. Assign an Admin and activate it to start work.",
  active: "",
  paused:
    "Paused: everything stays visible and editable, but recurring projects create no new cycles.",
  inactive:
    "Inactive: stays searchable and editable, but no new projects, items or client-labelled tasks until it is reactivated.",
};

/** The record as the app shows it (the Owner sees every one; an Admin their assigned ones). */
export type Client = {
  id: string;
  name: string;
  legalName: string | null;
  state: ClientState;
  adminId: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  driveUrl: string | null;
  requirements: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientContact = {
  id: string;
  clientId: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  customFields: Record<string, unknown>;
  archivedAt: string | null;
};

export type ClientBrand = {
  clientId: string;
  logoFileId: string | null;
  colors: BrandColor[];
  fonts: BrandFont[];
  toneOfVoice: string | null;
  brandNotes: string | null;
};

export type ClientAdminAssignment = {
  id: string;
  adminId: string;
  assignedBy: string | null;
  fromAt: string;
  toAt: string | null;
};

/** The name and brand basics: what Staff see of a client (ADR-0005, `client_labels`). */
export type ClientLabel = {
  id: string;
  name: string;
  state: ClientState;
  logoFileId: string | null;
  colors: BrandColor[];
  fonts: BrandFont[];
  toneOfVoice: string | null;
  brandNotes: string | null;
};

export type ClientLifecycleAction = "activate" | "pause" | "close" | "reactivate";

/**
 * The lifecycle moves a state allows (WORKFLOWS §4), for the Owner's ⋯ menu (3.4). The functions
 * decide again in the database; this only keeps a screen from offering a move that would be
 * refused.
 */
export function clientLifecycleActions(state: ClientState): readonly ClientLifecycleAction[] {
  switch (state) {
    case "draft":
      return ["activate"];
    case "active":
      return ["pause", "close"];
    case "paused":
      return ["activate", "close"];
    case "inactive":
      return ["reactivate"];
  }
}

export const CLIENT_ACTION_LABELS: Record<ClientLifecycleAction, string> = {
  activate: "Activate",
  pause: "Pause",
  close: "Close",
  reactivate: "Reactivate",
};

/** Sorts by name, case-insensitively; a stable order for lists and pickers. */
export function sortClients<T extends { name: string }>(clients: readonly T[]): T[] {
  return [...clients].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
