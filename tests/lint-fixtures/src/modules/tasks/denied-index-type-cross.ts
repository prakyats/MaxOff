// The public surface of a module must not reach into another module, even for types.
import type { leaveRule } from "../leave/domain/rules";

export type Wrong = typeof leaveRule;
