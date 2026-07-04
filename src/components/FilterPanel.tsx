import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/react";
import { distinctFieldValues, type PivotModel } from "../viewer/pivot";
import { entityName, entityType } from "../viewer/model";
import { IfcEditor, type FilterOperator } from "../ifc/editor";
import { modelCatalog } from "../ifc/idsCatalog";
import { ToolIcon } from "./icons";
import { useDockResize } from "../hooks/useDockResize";

import { DEFAULT_FILTER_RULES, type FilterAction, type FilterRule, type NameOp } from "./filterRules";

// Re-exported for existing importers; the definitions live in ./filterRules.
export { DEFAULT_FILTER_RULES };
export type { FilterAction, FilterRule };

type Rule = FilterRule;

const PROP_OPS: FilterOperator[] = ["=", "!=", ">", "<", ">=", "<=", "CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_NULL", "IS_NOT_NULL"];

interface Props {
  editor: IfcEditor;
  pivotModels: PivotModel[];
  /** Rules are owned by the Viewer so they survive closing/reopening the dock. */
  rules: FilterRule[];
  onRules: (rules: FilterRule[]) => void;
  combinator: "AND" | "OR";
  onCombinator: (c: "AND" | "OR") => void;
  /** Apply the matched ids in 3D: select / isolate / hide / color. */
  onResult: (ids: number[], action: FilterAction) => void;
  /** Undo a previous run: restore visibility, colors and selection. */
  onReset: () => void;
  onClose: () => void;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rule-based select/isolate/hide/color, docked at the bottom like the
 *  Table/Clash panels. */
export function FilterPanel({ editor, pivotModels, rules, onRules, combinator, onCombinator, onResult, onReset, onClose }: Props) {
  const { t } = useI18n();
  const [count, setCount] = useState<number | null>(null);
  const { height: dockH, startResize: startResizeDock } = useDockResize("dockH:filter", 280);

  // Suggest ONLY what's actually in the loaded model(s) — not the full
  // buildingSMART catalog (hundreds of Pset_*), which overflowed the dropdown.
  const suggest = useMemo(() => {
    const m = modelCatalog(pivotModels);
    return { classes: m.classes, psets: m.psets, props: m.properties };
  }, [pivotModels]);

  // Spatial containers of the PRIMARY model (the one the filter queries): every
  // site/building/storey/space node under spatialHierarchy.project, with a
  // display label ("name — falls back to class — #id"; duplicates get the id).
  const spatial = useMemo(() => {
    const primary = pivotModels.find((m) => m.offset === 0) ?? pivotModels[0];
    const store = primary?.store as any;
    const root = store?.spatialHierarchy?.project ?? null;
    const opts: { id: number; label: string }[] = [];
    if (root) {
      const used = new Set<string>();
      const visit = (n: any, depth: number) => {
        if (depth > 0) { // skip the IfcProject root — selecting it means "everything"
          let label = String(n.name || entityName(store, n.expressId) || entityType(store, n.expressId) || `#${n.expressId}`).trim() || `#${n.expressId}`;
          if (used.has(label)) label = `${label} (#${n.expressId})`;
          used.add(label);
          opts.push({ id: n.expressId, label });
        }
        for (const c of n.children ?? []) visit(c, depth + 1);
      };
      visit(root, 0);
    }
    return { root, opts };
  }, [pivotModels]);

  // Elements under the chosen containers, recursively (containment in the
  // hierarchy is per-node, so a building/site must union its descendants).
  const spatialElements = (ids: number[]): Set<number> => {
    const out = new Set<number>();
    if (!spatial.root || !ids.length) return out;
    const want = new Set(ids);
    const walk = (n: any, inSel: boolean) => {
      const sel = inSel || want.has(n.expressId);
      if (sel) for (const e of n.elements ?? []) out.add(e);
      for (const c of n.children ?? []) walk(c, sel);
    };
    walk(spatial.root, false);
    return out;
  };

  useEffect(() => setCount(null), [rules, combinator]);

  const isActive = (r: Rule): boolean =>
    r.kind === "type" ? r.classes.length > 0
    : r.kind === "spatial" ? r.ids.length > 0
    : r.kind === "property" ? !!r.prop.trim()
    : !!r.value.trim();

  const ruleIds = (r: Rule): Set<number> => {
    if (r.kind === "type") {
      const out = new Set<number>();
      for (const c of r.classes) for (const id of editor.expressIdsOfClass(c)) out.add(id);
      return out;
    }
    if (r.kind === "spatial") return spatialElements(r.ids);
    if (r.kind === "property") {
      if (!r.prop.trim()) return new Set();
      return new Set(editor.bulkSelect({ propertyFilters: [{ psetName: r.pset.trim() || undefined, propName: r.prop.trim(), operator: r.op, value: r.value }] }));
    }
    if (!r.value.trim()) return new Set();
    const pattern = r.op === "regex" ? r.value : r.op === "equals" ? `^${escapeRegex(r.value)}$` : `.*${escapeRegex(r.value)}.*`;
    return new Set(editor.bulkSelect({ namePattern: pattern }));
  };

  const activeRules = rules.filter(isActive);

  // Live per-rule match counts + value suggestions run on a DEFERRED copy of the
  // rules so typing stays responsive on large models.
  const deferredRules = useDeferredValue(rules);
  const ruleCounts = useMemo(
    () => deferredRules.map((r) => {
      if (!isActive(r)) return null;
      try { return ruleIds(r).size; } catch { return null; }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferredRules, editor, spatial],
  );
  // Distinct model values per property rule (keyed pset::prop).
  const valueSuggest = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of deferredRules) {
      if (r.kind !== "property" || !r.prop.trim()) continue;
      const k = `${r.pset.trim()}::${r.prop.trim()}`;
      if (!map.has(k)) {
        try { map.set(k, distinctFieldValues(pivotModels, r.pset, r.prop)); } catch { map.set(k, []); }
      }
    }
    return map;
  }, [deferredRules, pivotModels]);

  const compute = (): number[] => {
    if (!activeRules.length) return [];
    const sets = activeRules.map(ruleIds);
    let ids: number[];
    if (combinator === "OR") {
      const u = new Set<number>();
      for (const s of sets) for (const id of s) u.add(id);
      ids = [...u];
    } else {
      sets.sort((a, b) => a.size - b.size);
      ids = [...sets[0]].filter((id) => sets.every((s) => s.has(id)));
    }
    return ids;
  };

  const run = (action: FilterAction) => {
    const ids = compute();
    setCount(ids.length);
    onResult(ids, action);
  };

  const setRule = (i: number, r: Rule) => onRules(rules.map((x, k) => (k === i ? r : x)));
  const addRule = (kind: Rule["kind"]) => onRules([...rules, freshRule(kind)]);
  const removeRule = (i: number) => onRules(rules.filter((_, k) => k !== i));

  const canRun = activeRules.length > 0;

  return (
    <div className="an-dock filter-dock" style={{ height: dockH }}>
      <div className="an-dock-resize" onPointerDown={startResizeDock} title={t("viewer.resize")} />
      <div className="an-bar filter-topbar">
        <span className="filter-title">
          <ToolIcon kind="filter" />
          <strong>{t("filter.title")}</strong>
        </span>
        <div className="seg">
          <button className={combinator === "AND" ? "active" : ""} onClick={() => onCombinator("AND")}>{t("filter.and")}</button>
          <button className={combinator === "OR" ? "active" : ""} onClick={() => onCombinator("OR")}>{t("filter.or")}</button>
        </div>
        {count != null && <span className="idse-audit ok">{t("filter.matched", { n: count })}</span>}
        <span className="clash-spacer" />
        {count != null && (
          <button className="btn secondary small" onClick={() => { setCount(null); onReset(); }}>{t("filter.reset")}</button>
        )}
        <button className="btn secondary small" disabled={!canRun} onClick={() => run("color")}>{t("filter.color")}</button>
        <button className="btn secondary small" disabled={!canRun} onClick={() => run("hide")}>{t("filter.hide")}</button>
        <button className="btn secondary small" disabled={!canRun} onClick={() => run("isolate")}>{t("filter.isolate")}</button>
        <button className="btn small" disabled={!canRun} onClick={() => run("select")}>{t("filter.select")}</button>
        <button className="clash-close" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>×</button>
      </div>

      <div className="filter-body filter-panel-body">
        {rules.map((r, i) => (
          <div key={i} className="filter-rule">
            <select className="filter-kind" value={r.kind} onChange={(e) => setRule(i, freshRule(e.target.value as Rule["kind"]))}>
              <option value="type">{t("filter.ruleType")}</option>
              <option value="spatial">{t("filter.ruleSpatial")}</option>
              <option value="property">{t("filter.ruleProperty")}</option>
              <option value="name">{t("filter.ruleName")}</option>
            </select>

            {r.kind === "type" && (
              <Chips values={r.classes} suggestions={suggest.classes} placeholder={t("filter.addClass")} onChange={(classes) => setRule(i, { kind: "type", classes })} />
            )}
            {r.kind === "spatial" && (
              <SpatialChips values={r.ids} options={spatial.opts} placeholder={t("filter.addContainer")} onChange={(ids) => setRule(i, { kind: "spatial", ids })} />
            )}
            {r.kind === "property" && (
              <>
                <ComboInput value={r.pset} list={suggest.psets} placeholder={t("filter.pset")} onChange={(v) => setRule(i, { ...r, pset: v })} />
                <ComboInput value={r.prop} list={suggest.props} placeholder={t("filter.prop")} onChange={(v) => setRule(i, { ...r, prop: v })} />
                <select value={r.op} onChange={(e) => setRule(i, { ...r, op: e.target.value as FilterOperator })}>
                  {PROP_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {r.op !== "IS_NULL" && r.op !== "IS_NOT_NULL" && (
                  <ComboInput
                    value={r.value}
                    list={valueSuggest.get(`${r.pset.trim()}::${r.prop.trim()}`)}
                    placeholder={t("filter.value")}
                    onChange={(v) => setRule(i, { ...r, value: v })}
                  />
                )}
              </>
            )}
            {r.kind === "name" && (
              <>
                <select value={r.op} onChange={(e) => setRule(i, { ...r, op: e.target.value as NameOp })}>
                  <option value="contains">{t("filter.contains")}</option>
                  <option value="equals">{t("filter.equals")}</option>
                  <option value="regex">{t("filter.regex")}</option>
                </select>
                <ComboInput value={r.value} placeholder={t("filter.value")} onChange={(v) => setRule(i, { ...r, value: v })} />
              </>
            )}

            {ruleCounts[i] != null && <span className="filter-count">{t("filter.ruleCount", { n: ruleCounts[i] as number })}</span>}
            <button className="idse-spec-x" title={t("common.remove")} disabled={rules.length <= 1} onClick={() => removeRule(i)}>×</button>
          </div>
        ))}

        <select className="idse-add" value="" onChange={(e) => { if (e.target.value) addRule(e.target.value as Rule["kind"]); e.target.value = ""; }}>
          <option value="">{t("filter.addRule")}</option>
          <option value="type">{t("filter.ruleType")}</option>
          <option value="spatial">{t("filter.ruleSpatial")}</option>
          <option value="property">{t("filter.ruleProperty")}</option>
          <option value="name">{t("filter.ruleName")}</option>
        </select>
      </div>
    </div>
  );
}

/** A blank rule of the given kind (used for both add and kind-switch). */
function freshRule(kind: Rule["kind"]): Rule {
  switch (kind) {
    case "type": return { kind: "type", classes: [] };
    case "spatial": return { kind: "spatial", ids: [] };
    case "property": return { kind: "property", pset: "", prop: "", op: "=", value: "" };
    default: return { kind: "name", op: "contains", value: "" };
  }
}

/** Themed suggestion menu, portaled to <body> with fixed positioning so it
 *  escapes the dock's overflow clipping. Filters options by the typed query. */
const MENU_CAP = 50;
function ComboMenu({ anchorEl, query, options, exclude, onPick, onClose }: {
  anchorEl: HTMLElement | null; query: string; options: string[]; exclude?: string[];
  onPick: (v: string) => void; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(() => anchorEl?.getBoundingClientRect() ?? null);
  useEffect(() => {
    if (!anchorEl) return;
    setRect(anchorEl.getBoundingClientRect());
    const inside = (n: Node | null) => !!n && (anchorEl.contains(n) || !!menuRef.current?.contains(n));
    // Reposition/close when the page scrolls, but ignore scrolling within the menu itself.
    const onScroll = (e: Event) => { if (!inside(e.target as Node)) onClose(); };
    const onResize = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: PointerEvent) => { if (!inside(e.target as Node)) onClose(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [anchorEl, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const ex = new Set(exclude ?? []);
    return options.filter((o) => !ex.has(o) && (!q || o.toUpperCase().includes(q)));
  }, [query, options, exclude]);

  if (!rect || !filtered.length) return null;
  const shown = filtered.slice(0, MENU_CAP);
  return createPortal(
    <div ref={menuRef} className="combo-menu" style={{ left: rect.left, top: rect.bottom + 2, minWidth: rect.width }}>
      {shown.map((o) => (
        <div key={o} className="combo-opt" onMouseDown={(e) => { e.preventDefault(); onPick(o); }}>{o}</div>
      ))}
      {filtered.length > shown.length && <div className="combo-more">+{filtered.length - shown.length}…</div>}
    </div>,
    document.body,
  );
}

function ComboInput({ value, list, placeholder, onChange }: { value: string; list?: string[]; placeholder?: string; onChange: (v: string) => void }) {
  const opts = useMemo(() => list ?? [], [list]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className="filter-field">
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
      />
      {open && opts.length > 0 && (
        <ComboMenu anchorEl={inputRef.current} query={value} options={opts} onPick={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

function Chips({ values, suggestions, placeholder, onChange }: { values: string[]; suggestions: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const v = raw.trim().toUpperCase();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <span className="filter-chips">
      {values.map((v) => (
        <span key={v} className="filter-chip">{v}<button onClick={() => onChange(values.filter((x) => x !== v))}>×</button></span>
      ))}
      <input
        ref={inputRef}
        value={draft} placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { const v = e.target.value; setOpen(true); if (v.endsWith(",")) add(v.slice(0, -1)); else setDraft(v); }}
        onKeyDown={(e) => { if (e.key === "Enter" && draft) { e.preventDefault(); add(draft); } }}
        onBlur={() => draft && add(draft)}
      />
      {open && suggestions.length > 0 && (
        <ComboMenu anchorEl={inputRef.current} query={draft} options={suggestions} exclude={values} onPick={(v) => { add(v); inputRef.current?.focus(); }} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

/** Chip editor for spatial containers: like Chips, but options are {id,label}
 *  pairs, labels keep their original case, and free text only resolves to a
 *  known container (a made-up storey can't match anything). */
function SpatialChips({ values, options, placeholder, onChange }: {
  values: number[]; options: { id: number; label: string }[]; placeholder: string; onChange: (v: number[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const byLabel = useMemo(() => new Map(options.map((o) => [o.label, o.id])), [options]);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options]);
  const pick = (label: string) => {
    const id = byLabel.get(label);
    if (id != null && !values.includes(id)) onChange([...values, id]);
    setDraft("");
  };
  return (
    <span className="filter-chips">
      {values.map((id) => (
        <span key={id} className="filter-chip">{byId.get(id) ?? `#${id}`}<button onClick={() => onChange(values.filter((x) => x !== id))}>×</button></span>
      ))}
      <input
        ref={inputRef}
        value={draft} placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !draft.trim()) return;
          e.preventDefault();
          const q = draft.trim().toLowerCase();
          const m = options.find((o) => o.label.toLowerCase() === q) ?? options.find((o) => o.label.toLowerCase().includes(q));
          if (m) pick(m.label);
        }}
      />
      {open && options.length > 0 && (
        <ComboMenu
          anchorEl={inputRef.current}
          query={draft}
          options={options.map((o) => o.label)}
          exclude={values.map((id) => byId.get(id) ?? "")}
          onPick={(v) => { pick(v); inputRef.current?.focus(); }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

export default FilterPanel;
