/**
 * core/lists: the `list_items` engine (ADR-0002). This barrel is client-safe (registry and
 * schemas); the repository lives in `@/core/lists/server` because it is `server-only`.
 */
export { isListKey, LIST_KEYS, LIST_LABELS, type ListKey } from "./registry";
export {
  LIST_ITEM_DESCRIPTION_MAX,
  LIST_ITEM_NAME_MAX,
  type ListItemInput,
  listItemInputSchema,
  nextPosition,
} from "./schemas";
