/**
 * What a step that only fails on CI carries in its error (v7.0; the advisor, 25 Nov 2026: "no fix
 * without a cause"). CI's traces cannot be opened from here, so a race the local runs never show
 * appends what it needs to know to its error message, which the job log prints. Nothing here
 * changes what a test checks: the step runs as before, and only when it throws is the record
 * read and appended. Every project, unlike `webkit-diagnostics.ts` (the iPhone's alone).
 */
export async function recordOnFailure<T>(
  step: () => Promise<T>,
  record: () => Promise<string>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    const text = await record().catch((reason: unknown) => `(no record: ${String(reason)})`);
    const note = `\n--- on failure ---\n${text}`;
    if (error instanceof Error) {
      error.message = `${error.message}${note}`;
      throw error;
    }
    throw new Error(`${String(error)}${note}`);
  }
}
