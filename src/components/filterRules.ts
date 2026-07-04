// The filter-rule model, split out of FilterPanel so the Viewer can own the
// rule state (and other modules can type against it) without eagerly bundling
// the panel component — FilterPanel itself is loaded lazily.
import type { FilterOperator } from "../ifc/editor";

export type NameOp = "contains" | "equals" | "regex";

export type FilterRule =
  | { kind: "type"; classes: string[] }
  | { kind: "spatial"; ids: number[] } // express ids of storey/building/site containers
  | { kind: "property"; pset: string; prop: string; op: FilterOperator; value: string }
  | { kind: "name"; op: NameOp; value: string };

/** What to do with the matched elements in 3D. */
export type FilterAction = "select" | "isolate" | "hide" | "color";

/** The initial rule set for a fresh filter (one empty type rule). */
export const DEFAULT_FILTER_RULES: FilterRule[] = [{ kind: "type", classes: [] }];
