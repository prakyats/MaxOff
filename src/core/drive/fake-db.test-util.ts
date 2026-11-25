/**
 * A stand-in for the service and server Supabase clients in the Drive unit tests: answers the
 * few reads `core/drive` makes from in-memory rows, and records every RPC with its arguments.
 */
export type RpcCall = { name: string; args: Record<string, unknown> };

export function fakeDb(input: {
  account?: Record<string, unknown> | null;
  orgId?: string;
  rpc?: (call: RpcCall) => { data?: unknown; error?: { message: string } | null };
  /** Rows a list read of another table answers (v4.5: `upload_files`' owners). */
  tables?: Record<string, unknown[]>;
}) {
  const calls: RpcCall[] = [];
  const answer = (table: string) => {
    if (table === "members") return { data: { org_id: input.orgId ?? "org-1" }, error: null };
    if (table === "drive_account") return { data: input.account ?? null, error: null };
    if (input.tables?.[table]) return { data: input.tables[table], error: null };
    return { data: null, error: { message: `unexpected table ${table}` } };
  };
  const client = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: async () => answer(table),
        maybeSingle: async () => answer(table),
        then: (resolve: (value: unknown) => void) => {
          const { data, error } = answer(table);
          resolve({ data: Array.isArray(data) ? data : data ? [data] : [], error });
        },
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const call = { name, args };
      calls.push(call);
      const result = input.rpc?.(call) ?? {};
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };
  return { client, calls };
}
