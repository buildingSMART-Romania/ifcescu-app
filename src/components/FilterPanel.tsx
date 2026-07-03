import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/react";
import type { PivotModel } from "../viewer/pivot";
import { IfcEditor, type FilterOperator } from "../ifc/editor";
import { modelCatalog } from "../ifc/idsCatalog";
import { ToolIcon } from "./icons";

type NameOp = "contains" | "equals" | "regex";
type Rule =
  | { kind: "type"; classes: string[] }
  | { kind: "property"; pset: string; prop: string; op: FilterOperator; value: string }
  | { kind: "name"; op: NameOp; value: string };

const PROP_OPS: FilterOperator[] = ["=", "!=", ">", "<", ">=", "<=", "CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_NULL", "IS_NOT_NULL"];

interface Props {
  editor: IfcEditor;
  pivotModels: PivotModel[];
  /** Apply the matched ids: select (isolate=false) or isolate (isolate=true) in 3D. */
  onResult: (ids: number[], isolate: boolean) => void;
  onClose: () => void;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rule-based select/isolate, docked at the bottom like the Table/Clash panels. */
export function FilterPanel({ editor, pivotModels, onResult, onClose }: Props) {
  const { t } = useI18n();
  const [rules, setRules] = useState<Rule[]>([{ kind: "type", classes: [] }]);
  const [combinator, setCombinator] = useState<"AND" | "OR">("AND");
  const [count, setCount] = useState<number | null>(null);
  const [dockH, setDockH] = useState(280);

  const startResizeDock = (e: { clientY: number; preventDefault: () => void }) => {
    e.preventDefault();
    const sy = e.clientY, h0 = dockH;
    const move = (ev: PointerEvent) => setDockH(Math.max(160, Math.min(window.innerHeight - 140, h0 + (sy - ev.clientY))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Suggest ONLY what's actually in the loaded model(s) — not the full
  // buildingSMART catalog (hundreds of Pset_*), which overflowed the dropdown.
  const suggest = useMemo(() => {
    const m = modelCatalog(pivotModels);
    return { classes: m.classes, psets: m.psets, props: m.properties };
  }, [pivotModels]);

  useEffect(() => setCount(null), [rules, combinator]);

  const ruleIds = (r: Rule): Set<number> => {
    if (r.kind === "type") {
      const out = new Set<number>();
      for (const c of r.classes) for (const id of editor.expressIdsOfClass(c)) out.add(id);
      return out;
    }
    if (r.kind === "property") {
      if (!r.prop.trim()) return new Set();
      return new Set(editor.bulkSelect({ propertyFilters: [{ psetName: r.pset.trim() || undefined, propName: r.prop.trim(), operator: r.op, value: r.value }] }));
    }
    if (!r.value.trim()) return new Set();
    const pattern = r.op === "regex" ? r.value : r.op === "equals" ? `^${escapeRegex(r.value)}$` : `.*${escapeRegex(r.value)}.*`;
    return new Set(editor.bulkSelect({ namePattern: pattern }));
  };

  const activeRules = rules.filter((r) =>
    r.kind === "type" ? r.classes.length > 0 : r.kind === "property" ? r.prop.trim() : r.value.trim(),
  );

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

  const run = (isolate: boolean) => {
    const ids = compute();
    setCount(ids.length);
    onResult(ids, isolate);
  };

  const setRule = (i: number, r: Rule) => setRules((rs) => rs.map((x, k) => (k === i ? r : x)));
  const addRule = (kind: Rule["kind"]) => setRules((rs) => [...rs, kind === "type" ? { kind: "type", classes: [] } : kind === "property" ? { kind: "property", pset: "", prop: "", op: "=", value: "" } : { kind: "name", op: "contains", value: "" }]);
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, k) => k !== i));

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
          <button className={combinator === "AND" ? "active" : ""} onClick={() => setCombinator("AND")}>{t("filter.and")}</button>
          <button className={combinator === "OR" ? "active" : ""} onClick={() => setCombinator("OR")}>{t("filter.or")}</button>
        </div>
        {count != null && <span className="idse-audit ok">{t("filter.matched", { n: count })}</span>}
        <span className="clash-spacer" />
        <button className="btn secondary small" disabled={!canRun} onClick={() => run(true)}>{t("filter.isolate")}</button>
        <button className="btn small" disabled={!canRun} onClick={() => run(false)}>{t("filter.select")}</button>
        <button className="clash-close" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>×</button>
      </div>

      <div className="filter-body filter-panel-body">
        {rules.map((r, i) => (
          <div key={i} className="filter-rule">
            <select className="filter-kind" value={r.kind} onChange={(e) => addReplace(e.target.value as Rule["kind"], i, setRule)}>
              <option value="type">{t("filter.ruleType")}</option>
              <option value="property">{t("filter.ruleProperty")}</option>
              <option value="name">{t("filter.ruleName")}</option>
            </select>

            {r.kind === "type" && (
              <Chips values={r.classes} suggestions={suggest.classes} placeholder={t("filter.addClass")} onChange={(classes) => setRule(i, { kind: "type", classes })} />
            )}
            {r.kind === "property" && (
              <>
                <ComboInput value={r.pset} list={suggest.psets} placeholder={t("filter.pset")} onChange={(v) => setRule(i, { ...r, pset: v })} />
                <ComboInput value={r.prop} list={suggest.props} placeholder={t("filter.prop")} onChange={(v) => setRule(i, { ...r, prop: v })} />
                <select value={r.op} onChange={(e) => setRule(i, { ...r, op: e.target.value as FilterOperator })}>
                  {PROP_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {r.op !== "IS_NULL" && r.op !== "IS_NOT_NULL" && (
                  <ComboInput value={r.value} placeholder={t("filter.value")} onChange={(v) => setRule(i, { ...r, value: v })} />
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

            <button className="idse-spec-x" title={t("common.remove")} disabled={rules.length <= 1} onClick={() => removeRule(i)}>×</button>
          </div>
        ))}

        <select className="idse-add" value="" onChange={(e) => { if (e.target.value) addRule(e.target.value as Rule["kind"]); e.target.value = ""; }}>
          <option value="">{t("filter.addRule")}</option>
          <option value="type">{t("filter.ruleType")}</option>
          <option value="property">{t("filter.ruleProperty")}</option>
          <option value="name">{t("filter.ruleName")}</option>
        </select>
      </div>
    </div>
  );
}

/** Switch a rule's kind in place (resets its fields to the new kind's defaults). */
function addReplace(kind: Rule["kind"], i: number, setRule: (i: number, r: Rule) => void) {
  setRule(i, kind === "type" ? { kind: "type", classes: [] } : kind === "property" ? { kind: "property", pset: "", prop: "", op: "=", value: "" } : { kind: "name", op: "contains", value: "" });
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

export default FilterPanel;
