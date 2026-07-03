import { useMemo, useState } from "react";
import { IFC_ENTITY_NAMES } from "@ifc-lite/data";
import { useI18n } from "../i18n/react";
import { UiIcon } from "./icons";

export interface TreeNode {
  expressID: number;
  type: string;
  name: string;
  ids: number[]; // renderable expressIDs in this subtree (∩ model geometry)
  children: TreeNode[];
  count?: number; // when set, this is a synthetic "class group" node of `count` elements
  defaultOpen?: boolean; // overrides the depth-based default expansion
}

// Canonical IFC class name in PascalCase ("IFCWALL" → "IfcWall"). The
// IFC_ENTITY_NAMES map (IFC4X3 schema) is the only source that recovers word
// boundaries for multi-word classes (IFCWALLSTANDARDCASE → IfcWallStandardCase).
// No Romanian translations — classes are shown exactly as their IFC type.
export function friendly(type: string): string {
  if (!type) return "";
  const hit = IFC_ENTITY_NAMES[type.toUpperCase()];
  if (hit) return hit;
  const rest = type.replace(/^IFC/i, "");
  return "Ifc" + rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
}

interface Props {
  /** Top-level nodes. Spatial view passes a single project node; Class/Material
   * views pass the group nodes directly (no IfcProject wrapper). */
  roots: TreeNode[];
  /** Expansion is fully controlled by the parent so it survives view switches
   *  (the parent keeps one set per view). A node is open iff its id is present. */
  expanded: Set<number>;
  onToggle: (expressID: number) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  visibleIds: Set<number>;
  selectedIds: Set<number>;
  onSelect: (ids: number[], expressID: number) => void;
  onToggleVisible: (ids: number[], visible: boolean) => void;
}

/** Whether a node is open by default (used by the parent to seed the expanded set). */
export function defaultNodeOpen(node: TreeNode, depth: number): boolean {
  return node.defaultOpen ?? depth < 2;
}

/** The row label shown for a node (shared by the tree row and the width auto-fit). */
export function nodeLabel(node: TreeNode): string {
  const hasChildren = node.children.length > 0;
  const groupLabel = node.name ? node.name : friendly(node.type);
  return node.type === "MODEL"
    ? `${node.name}${node.count != null ? ` (${node.count})` : ""}`
    : node.count != null
      ? `${groupLabel} (${node.count})`
      : !hasChildren
        ? node.name || `${friendly(node.type)} #${node.expressID}`
        : node.name
          ? `${friendly(node.type)}: ${node.name}`
          : `${friendly(node.type)} #${node.expressID}`;
}

/** A node's searchable text: its name plus its (friendly) IFC class. */
function nodeText(node: TreeNode): string {
  return `${node.name || ""} ${friendly(node.type)}`.toLowerCase();
}

/** Keep nodes that match `q` or have a matching descendant. A self-matching
 *  branch keeps all its children (so the whole matching subtree is visible);
 *  otherwise only matching descendants are kept. Returns null when nothing
 *  in the subtree matches. */
function filterTree(node: TreeNode, q: string): TreeNode | null {
  const selfMatch = nodeText(node).includes(q);
  const kids = node.children.map((c) => filterTree(c, q)).filter(Boolean) as TreeNode[];
  if (selfMatch) return { ...node, children: node.children };
  if (kids.length) return { ...node, children: kids };
  return null;
}

/** Ids of every branch node in the (filtered) forest — used to auto-expand the
 *  paths to matches while searching. */
function collectBranchIds(nodes: TreeNode[], out: Set<number>): void {
  for (const n of nodes) {
    if (n.children.length) {
      out.add(n.expressID);
      collectBranchIds(n.children, out);
    }
  }
}

export function IfcTree({ roots, expanded, onToggle, onCollapseAll, onExpandAll, visibleIds, selectedIds, onSelect, onToggleVisible }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  // Manual open/close toggles made WHILE searching (XOR-ed over the auto-expanded
  // set so the user can still collapse a branch during a search).
  const [searchToggles, setSearchToggles] = useState<Set<number>>(new Set());
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () => (q ? (roots.map((r) => filterTree(r, q)).filter(Boolean) as TreeNode[]) : roots),
    [roots, q],
  );
  const autoExpanded = useMemo(() => {
    const s = new Set<number>();
    if (q) collectBranchIds(filtered, s);
    return s;
  }, [filtered, q]);

  // While searching, expansion is auto (paths to matches) with the user's manual
  // toggles applied; otherwise it's the parent-controlled set.
  const effExpanded = useMemo(() => {
    if (!q) return expanded;
    const s = new Set(autoExpanded);
    for (const id of searchToggles) (s.has(id) ? s.delete(id) : s.add(id));
    return s;
  }, [q, expanded, autoExpanded, searchToggles]);

  const effToggle = q
    ? (id: number) =>
        setSearchToggles((prev) => {
          const n = new Set(prev);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        })
    : onToggle;

  const onQuery = (v: string) => {
    setQuery(v);
    setSearchToggles(new Set()); // reset manual toggles for the new query
  };

  return (
    <div className="ifctree-body">
      <div className="ifctree-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input
          type="text"
          value={query}
          placeholder={t("tree.searchPlaceholder")}
          onChange={(e) => onQuery(e.target.value)}
        />
        {query && (
          <span className="tree-search-clear" title={t("tree.searchClear")} onClick={() => onQuery("")}>×</span>
        )}
      </div>
      <div className="ifctree-toolbar">
        <button className="tree-act" title={t("tree.collapseAll")} onClick={onCollapseAll}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9l8-5 8 5M4 15l8 5 8-5M9 12h6" /></svg>
          <span>{t("tree.collapseAll")}</span>
        </button>
        <button className="tree-act" title={t("tree.expandAll")} onClick={onExpandAll}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9l8 5 8-5M4 15l8 5 8-5" /></svg>
          <span>{t("tree.expandAll")}</span>
        </button>
      </div>
      <div className="ifctree">
        {q && filtered.length === 0 && <div className="tree-empty">{t("tree.noResults")}</div>}
        {filtered.map((node) => (
          <Node key={node.expressID} node={node} depth={0} {...{ expanded: effExpanded, onToggle: effToggle, visibleIds, selectedIds, onSelect, onToggleVisible }} />
        ))}
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  expanded,
  onToggle,
  visibleIds,
  selectedIds,
  onSelect,
  onToggleVisible,
}: { node: TreeNode; depth: number } & Omit<Props, "roots" | "onCollapseAll" | "onExpandAll">) {
  const { t } = useI18n();
  const open = expanded.has(node.expressID);
  const hasChildren = node.children.length > 0;

  const anyVisible = node.ids.some((id) => visibleIds.has(id));
  const selected = selectedIds.has(node.expressID);
  // Label rules:
  // - group rows (count != null): own name ("Concrete") or class ("IfcWall"), + count
  // - leaf rows (no children = last hierarchy level): NAME ONLY (no class prefix),
  //   falling back to "IfcWall #1234" only when the element is unnamed
  // - branch containers (have children): "IfcSite: SP4" so the class stays visible
  const label = nodeLabel(node);

  return (
    <div className="tnode">
      <div
        className={"trow" + (selected ? " selected" : "")}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <span
          className="tcaret"
          onClick={() => hasChildren && onToggle(node.expressID)}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          {open ? "▾" : "▸"}
        </span>
        <span
          className="teye"
          title={anyVisible ? t("tree.hide") : t("tree.show")}
          onClick={(e) => {
            e.stopPropagation();
            if (node.ids.length) onToggleVisible(node.ids, !anyVisible);
          }}
          style={{ opacity: node.ids.length ? 1 : 0.25 }}
        >
          <UiIcon kind={anyVisible ? "eye" : "eyeOff"} />
        </span>
        <span
          className={"tlabel" + (hasChildren ? " tbranch" : "")}
          title={label}
          onClick={() => node.ids.length && onSelect(node.ids, node.expressID)}
        >
          {node.type === "MODEL" && (
            <svg className="tmodel-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></svg>
          )}
          {label}
        </span>
      </div>
      {open &&
        node.children.map((c) => (
          <Node
            key={c.expressID}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            visibleIds={visibleIds}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onToggleVisible={onToggleVisible}
          />
        ))}
    </div>
  );
}
