import "server-only";

import { createServiceSupabase, type ServiceSupabase } from "@/core/db/service";

import { toBytea } from "./bytea";

/**
 * The upload link's service-role functions (v4.5, DATA-MODEL §8a "The public API's functions";
 * plan H2), for the public API routes and the Worker jobs only, never for a member's request.
 * Each one finds the link by the token's hash and the uploader by the device key's hash; the
 * database checks the link is alive itself (plan A5). The few direct reads below are of rows the
 * routes need to reach Google (a file's sealed session, its folder) and are scoped the same way.
 * Errors are thrown as they came (`app.fail` codes), for the route to map.
 */

type Hash = Uint8Array;

export type ResolveRow = {
  studio_name: string;
  task_title: string;
  can_start: "yes" | "drive_unavailable" | "paused";
  wait_seconds: number;
  uploader: {
    name: string;
    files: {
      name: string;
      relative_path: string;
      size_bytes: number;
      state: "held" | "uploading" | "done" | "failed";
    }[];
  } | null;
};

export type StartRow =
  | { result: "already_sent" }
  | { result: "held"; file_id: string }
  | {
      result: "wait";
      seconds: number;
      reason: "drive_unavailable" | "daily_limit" | "busy" | "too_many";
    }
  | {
      result: "start";
      file_id: string;
      name: string;
      size_bytes: number;
      mime_hint: string | null;
      session_uri_encrypted: string | null;
      account_sub: string;
      task_id: string;
      task_title: string;
      client_id: string | null;
      task_folder_id: string | null;
      uploader_id: string;
      folders: { relative_path: string; name: string; drive_folder_id: string | null }[];
    };

/** What the routes and the watch need of one file to ask Google about it. */
export type FileRow = {
  id: string;
  org_id: string;
  link_id: string;
  state: string;
  size_bytes: number;
  drive_parent_id: string | null;
  session_uri_encrypted: string | null;
};

const FILE_COLUMNS =
  "id, org_id, link_id, state, size_bytes, drive_parent_id, session_uri_encrypted";

export type WatchRow = {
  file_id: string;
  org_id: string;
  session_uri_encrypted: string;
  size_bytes: number;
  bytes_at_google: number;
};

/**
 * The service-role client for the public routes and the Worker jobs only (and the two steps the
 * database keeps service-role after a member's own check: the link's seal and the sheet's Drive
 * check). `core/drive` takes it to read the connected account.
 */
export function serviceClient(): ServiceSupabase {
  return createServiceSupabase();
}

export function uploadService(client: ServiceSupabase = serviceClient()) {
  return {
    /** The server seals a link it just made (plan A2): write-once. */
    async seal(linkId: string, hash: Hash): Promise<boolean> {
      const { data, error } = await client.rpc("upload_link_seal", {
        p_link_id: linkId,
        p_token_hash: toBytea(hash),
      });
      if (error) throw error;
      return data === true;
    },

    /** null for anything but an alive link (plan A6). */
    async resolve(token: Hash, device: Hash | null): Promise<ResolveRow | null> {
      const { data, error } = await client.rpc("upload_resolve", {
        p_token_hash: toBytea(token),
        p_device_key_hash: (device ? toBytea(device) : null) as string,
      });
      if (error) throw error;
      return (data as ResolveRow | null) ?? null;
    },

    async register(input: {
      token: Hash;
      device: Hash;
      name: string;
      ip: string | null;
      userAgent: string | null;
    }): Promise<{ uploader_id: string } | { refused: "rate_limited" }> {
      const { data, error } = await client.rpc("upload_register", {
        p_token_hash: toBytea(input.token),
        p_device_key_hash: toBytea(input.device),
        p_name: input.name,
        p_ip: input.ip,
        p_user_agent: input.userAgent as string,
      });
      if (error) throw error;
      return data as { uploader_id: string } | { refused: "rate_limited" };
    },

    async fileStart(input: {
      token: Hash;
      device: Hash;
      name: string;
      relativePath: string;
      sizeBytes: number;
      mimeType: string | null;
      ip: string | null;
      userAgent: string | null;
    }): Promise<StartRow> {
      const { data, error } = await client.rpc("upload_file_start", {
        p_token_hash: toBytea(input.token),
        p_device_key_hash: toBytea(input.device),
        p_name: input.name,
        p_relative_path: input.relativePath,
        p_size_bytes: input.sizeBytes,
        p_mime_hint: input.mimeType as string,
        p_ip: input.ip,
        p_user_agent: input.userAgent as string,
      });
      if (error) throw error;
      return data as StartRow;
    },

    /** Insert or return: the folder that won a race is the one kept (plan C11). */
    async folderPut(input: {
      uploaderId: string;
      accountSub: string;
      relativePath: string;
      driveFolderId: string;
    }): Promise<string> {
      const { data, error } = await client.rpc("upload_folder_put", {
        p_uploader_id: input.uploaderId,
        p_account_sub: input.accountSub,
        p_relative_path: input.relativePath,
        p_drive_folder_id: input.driveFolderId,
      });
      if (error) throw error;
      return data.drive_folder_id;
    },

    async sessionSet(input: {
      fileId: string;
      accountSub: string;
      parentId: string;
      sealedSession: string;
    }): Promise<void> {
      const { error } = await client.rpc("upload_session_set", {
        p_file_id: input.fileId,
        p_account_sub: input.accountSub,
        p_drive_parent_id: input.parentId,
        p_session_uri_encrypted: input.sealedSession,
      });
      if (error) throw error;
    },

    async progress(token: Hash, device: Hash, fileId: string, bytes: number): Promise<boolean> {
      const { data, error } = await client.rpc("upload_progress", {
        p_token_hash: toBytea(token),
        p_device_key_hash: toBytea(device),
        p_file_id: fileId,
        p_bytes: bytes,
      });
      if (error) throw error;
      return data === true;
    },

    async fileFailed(
      token: Hash,
      device: Hash,
      fileId: string,
      reason: "gave_up" | "unreadable",
    ): Promise<void> {
      const { error } = await client.rpc("upload_file_failed", {
        p_token_hash: toBytea(token),
        p_device_key_hash: toBytea(device),
        p_file_id: fileId,
        p_reason: reason,
      });
      if (error) throw error;
    },

    /** Google's own answer (plan F1): the database decides done or failed. */
    async fileDone(input: {
      fileId: string;
      driveFileId: string;
      size: number;
      md5Drive: string | null;
      parentId: string;
      md5Page: string | null;
    }): Promise<"done" | "failed" | "missing_in_drive"> {
      const { data, error } = await client.rpc("upload_file_done", {
        p_file_id: input.fileId,
        p_drive_file_id: input.driveFileId,
        p_size: input.size,
        p_md5_drive: input.md5Drive as string,
        p_parent_id: input.parentId,
        p_md5_page: input.md5Page as string,
      });
      if (error) throw error;
      return data as "done" | "failed" | "missing_in_drive";
    },

    async saidDone(token: Hash, device: Hash): Promise<void> {
      const { error } = await client.rpc("upload_said_done", {
        p_token_hash: toBytea(token),
        p_device_key_hash: toBytea(device),
      });
      if (error) throw error;
    },

    /** One hit for a network (plan C1–C2); the time it is blocked until, or null. */
    async rateHit(bucket: "bad_link" | "open", key: Hash, at: Date): Promise<Date | null> {
      const { data, error } = await client.rpc("upload_rate_hit", {
        p_bucket: bucket,
        p_key_hash: toBytea(key),
        p_at: at.toISOString(),
      });
      if (error) throw error;
      return data ? new Date(data) : null;
    },

    /**
     * Is this network blocked in `bucket` right now? A read only: `upload_rate_hit` counts as it
     * answers, and a good link must not count as a bad one (plan C1: blocked networks are
     * refused every link for 15 minutes).
     */
    async rateBlocked(bucket: "bad_link" | "open", key: Hash, at: Date): Promise<boolean> {
      const { data, error } = await client
        .from("upload_rate_hits")
        .select("blocked_until")
        .eq("bucket", bucket)
        .eq("key_hash", toBytea(key))
        .gt("blocked_until", at.toISOString())
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async fileRow(fileId: string): Promise<FileRow | null> {
      const { data, error } = await client
        .from("upload_files")
        .select(FILE_COLUMNS)
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    /**
     * The file when it is this device's on the link this token names (stopped or not: a file on
     * its way may finish, Q8), the scope `app.upload_own_file` applies; null otherwise.
     */
    async ownFile(token: Hash, device: Hash, fileId: string): Promise<FileRow | null> {
      const { data, error } = await client
        .from("upload_files")
        .select(
          `${FILE_COLUMNS}, uploader:upload_uploaders!inner(device_key_hash), link:upload_links!inner(token_hash)`,
        )
        .eq("id", fileId)
        .eq("uploader.device_key_hash", toBytea(device))
        .eq("link.token_hash", toBytea(token))
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        org_id: data.org_id,
        link_id: data.link_id,
        state: data.state,
        size_bytes: data.size_bytes,
        drive_parent_id: data.drive_parent_id,
        session_uri_encrypted: data.session_uri_encrypted,
      };
    },

    async uploaderOrg(uploaderId: string): Promise<string | null> {
      const { data, error } = await client
        .from("upload_uploaders")
        .select("org_id")
        .eq("id", uploaderId)
        .maybeSingle();
      if (error) throw error;
      return data?.org_id ?? null;
    },

    /** The client's name, for the task folder's path (`Clients/<client>/…`). */
    async clientName(clientId: string): Promise<string | null> {
      const { data, error } = await client
        .from("clients")
        .select("name")
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data?.name ?? null;
    },

    async watchDue(now: Date): Promise<WatchRow[]> {
      const { data, error } = await client.rpc("upload_watch_due", { p_now: now.toISOString() });
      if (error) throw error;
      return data ?? [];
    },

    async recordOffset(fileId: string, bytes: number, at: Date): Promise<boolean> {
      const { data, error } = await client.rpc("upload_record_offset", {
        p_file_id: fileId,
        p_bytes: bytes,
        p_at: at.toISOString(),
      });
      if (error) throw error;
      return data === true;
    },

    async signals(now: Date): Promise<{ stuck: number; looks_finished: number }> {
      const { data, error } = await client.rpc("upload_signals", { p_now: now.toISOString() });
      if (error) throw error;
      return data as { stuck: number; looks_finished: number };
    },

    /** Google's daily limit (§5B.6): returns the pause's end. */
    async dailyLimitHit(linkId: string, at: Date): Promise<Date> {
      const { data, error } = await client.rpc("upload_daily_limit_hit", {
        p_link_id: linkId,
        p_at: at.toISOString(),
      });
      if (error) throw error;
      return new Date(data);
    },

    /** The sheet's received files due for a Drive check, stamped in the same statement. */
    async driveCheckClaim(
      uploaderId: string,
      fileIds: readonly string[],
      now: Date,
    ): Promise<{ file_id: string; drive_file_id: string }[]> {
      const { data, error } = await client.rpc("upload_drive_check_claim", {
        p_uploader_id: uploaderId,
        p_file_ids: [...fileIds],
        p_now: now.toISOString(),
      });
      if (error) throw error;
      return data ?? [];
    },

    async driveSeen(
      fileId: string,
      outcome: "not_found" | "trashed" | "present",
      at: Date,
    ): Promise<string> {
      const { data, error } = await client.rpc("upload_drive_seen", {
        p_file_id: fileId,
        p_outcome: outcome,
        p_at: at.toISOString(),
      });
      if (error) throw error;
      return data;
    },
  };
}

export type UploadService = ReturnType<typeof uploadService>;
