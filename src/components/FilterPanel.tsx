import { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../i18n/react";
import { type IfcSchemaVersion } from "@ifc-lite/data";
import type { PivotModel } from "../viewer/pivot";
import { IfcEditor, type FilterOperator } from "../ifc/editor";
import { ifcClasses, propertySets, modelCatalog } from "../ifc/idsCatalog";

type NameOp = "contains" | "equals" | "regex";
type Rule =
  | { kind: "type"; classes: string[] }
  | { kind: "property"; pset: string; prop: string; op: FilterOperator; value: string }
  | { kind: "name"; op: NameOp; value: string };

const PROP_OPS: FilterOperator[] = ["=", "!=", ">", "<", ">=", "<=", "CONTAINS", "STARTS_WITH", "ENDS_WITH", "IS_NULL", "IS_NOT_NULL"];

interface Props {
  editor: IfcEditor;
  schema: IfcSchemaVersion;
  pivotModels: PivotModel[];
  /** Apply the matched ids: select (isolate=false) or isolate (isolate=true) in 3D. */
  onResult: (ids: number[], isolate: boolean) => void;
  onClose: () => void;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rule-based select/isolate, docked on the right like the IDS/BCF panels. */
export function FilterPanel({ editor, schema, pivotModels, onResult, onClose }: Props) {
  const { t } = useI18n();
  const [rules, setRules] = useState<Rule[]>([{ kind: "type", classes: [] }]);
  const [combinator, setCombinator] = useState<"AND" | "OR">("AND");
  const [count, setCount] = useState<number | null>(null);

  const [suggest, setSuggest] = useState<{ classes: string[]; psets: string[]; props: string[] }>({ classes: [], psets: [], props: [] });
  useEffect(() => {
    let live = true;
    (async () => {
      const [cls, ps] = await Promise.all([ifcClasses(schema), propertySets(schema)]);
      if (!live) return;
      const m = modelCatalog(pivotModels);
      const uniq = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();
      setSuggest({ classes: uniq(cls, m.classes), psets: uniq(ps.map((p) => p.name), m.psets), props: uniq(ps.flatMap((p) => p.properties.map((q) => q.name)), m.properties) });
    })();
    return () => { live = false; };
  }, [schema, pivotModels]);

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
    <div className="an-dock filter-dock">
      <div className="an-bar filter-topbar">
        <span className="filter-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18l-7 8.5V20l-4 1v-8.5z" /></svg>
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

function ComboInput({ value, list, placeholder, onChange }: { value: string; list?: string[]; placeholder?: string; onChange: (v: string) => void }) {
  const id = useId();
  const opts = useMemo(() => list ?? [], [list]);
  return (
    <span className="filter-field">
      <input value={value} placeholder={placeholder} list={opts.length ? id : undefined} onChange={(e) => onChange(e.target.value)} />
      {opts.length ? <datalist id={id}>{opts.map((o) => <option key={o} value={o} />)}</datalist> : null}
    </span>
  );
}

function Chips({ values, suggestions, placeholder, onChange }: { values: string[]; suggestions: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
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
        value={draft} placeholder={placeholder} list={id}
        onChange={(e) => { const v = e.target.value; if (v.endsWith(",")) add(v.slice(0, -1)); else setDraft(v); }}
        onKeyDown={(e) => { if (e.key === "Enter" && draft) { e.preventDefault(); add(draft); } }}
        onBlur={() => draft && add(draft)}
      />
      <datalist id={id}>{suggestions.map((o) => <option key={o} value={o} />)}</datalist>
    </span>
  );
}

export default FilterPanel;
