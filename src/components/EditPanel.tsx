import { useEffect, useMemo, useState } from "react";
import { getPropertySets, getInheritanceChain, findEntity, PropertyValueType, QuantityType } from "@ifc-lite/data";
import { useI18n } from "../i18n/react";
import type { IfcPropertySetInfo, IfcPropertyInfo, IfcSchemaVersion } from "@ifc-lite/data";
import type { IfcEditor, SelectionDetail } from "../ifc/editor";

interface Props {
  /** The model's editor (per-model overlay) and the local express id being edited. */
  editor: IfcEditor;
  id: number;
  /** Structured, view-aware snapshot of the element (from editor.getSelection). */
  detail: SelectionDetail;
  schema: IfcSchemaVersion;
  /** Called after a successful save so the viewer refreshes + flags the model dirty. */
  onSaved: () => void;
  onCancel: () => void;
}

interface Row {
  name: string;
  value: string;
  propType?: PropertyValueType;
  qtyType?: QuantityType;
  readonly?: boolean;
  isEnum?: boolean;
  orig: string;
  isNew?: boolean;
}
interface Group {
  kind: "attribute" | "pset" | "quantity";
  name: string;
  rows: Row[];
  isNew?: boolean;
}

// Property-type options offered for pset rows (covers the common IFC value types).
const TYPE_OPTS: { v: PropertyValueType; label: string }[] = [
  { v: PropertyValueType.Text, label: "Text" },
  { v: PropertyValueType.Label, label: "Label" },
  { v: PropertyValueType.Identifier, label: "Identifier" },
  { v: PropertyValueType.Real, label: "Real" },
  { v: PropertyValueType.Integer, label: "Integer" },
  { v: PropertyValueType.Boolean, label: "Boolean" },
];

/** Best-effort map from a standard pset property's declared type to a value type. */
function kindToType(p: IfcPropertyInfo): PropertyValueType {
  if (p.kind === "enumeration") return PropertyValueType.Enum;
  const d = (p.dataType ?? "").toLowerCase();
  if (d.includes("boolean") || d.includes("logical")) return PropertyValueType.Boolean;
  if (d.includes("integer") || d.includes("count")) return PropertyValueType.Integer;
  if (d.includes("identifier")) return PropertyValueType.Identifier;
  if (d.includes("text")) return PropertyValueType.Text;
  if (d.includes("label")) return PropertyValueType.Label;
  if (/real|measure|length|area|volume|ratio|number|positive|thermal|power|mass/.test(d)) return PropertyValueType.Real;
  return PropertyValueType.Text;
}

const fromDetail = (detail: SelectionDetail): Group[] =>
  detail.groups.map((g) => ({
    kind: g.kind,
    name: g.name,
    rows: g.rows.map((r) => ({ ...r, orig: r.value })),
  }));

/**
 * In-place editor for one selected element: edit IfcRoot attributes, existing
 * property/quantity values, add official buildingSMART properties, or add a whole
 * standard class pset. Save applies the diffs to the model's MutablePropertyView.
 */
export function EditPanel({ editor, id, detail, schema, onSaved, onCancel }: Props) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<Group[]>(() => fromDetail(detail));
  const [adding, setAdding] = useState(false);
  const [stdPsets, setStdPsets] = useState<readonly IfcPropertySetInfo[] | null>(null);
  // Full standard pset catalog (name → info), used both for the add-pset list and
  // the per-pset official-property picker. Only buildingSMART psets/props are offered.
  const [catalog, setCatalog] = useState<Map<string, IfcPropertySetInfo> | null>(null);
  // Allowed PredefinedType enum values for this element's class (schema lookup).
  const [predefValues, setPredefValues] = useState<string[]>([]);

  // Reset the form whenever the selected element (or its snapshot) changes.
  useEffect(() => {
    setGroups(fromDetail(detail));
    setAdding(false);
  }, [detail]);

  // Load the full standard pset catalog once per schema (keyed by pset name).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getPropertySets(schema);
        if (!cancelled) setCatalog(new Map(all.map((p) => [p.name, p])));
      } catch {
        if (!cancelled) setCatalog(new Map());
      }
    })();
    return () => { cancelled = true; };
  }, [schema]);

  // Load the class's PredefinedType enum values (for the dropdown).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ent = await findEntity(schema, detail.ifcClass);
        if (!cancelled) setPredefValues(ent?.predefinedTypes ? [...ent.predefinedTypes] : []);
      } catch {
        if (!cancelled) setPredefValues([]);
      }
    })();
    return () => { cancelled = true; };
  }, [schema, detail.ifcClass]);

  // Every set already on the element (pset OR quantity) — so the picker never
  // offers a duplicate, and a custom name can't collide with an existing set.
  const existingNames = useMemo(
    () => new Set(groups.filter((g) => g.kind !== "attribute").map((g) => g.name)),
    [groups],
  );

  // Standard psets applicable to this element's class + its supertypes — derived
  // from the loaded catalog once the add-pset list is opened.
  useEffect(() => {
    if (!adding || stdPsets || !catalog) return;
    let cancelled = false;
    (async () => {
      try {
        const chain = await getInheritanceChain(schema, detail.ifcClass);
        const names = new Set<string>([detail.ifcClass.toUpperCase(), ...chain.map((e) => e.name.toUpperCase())]);
        // Only true property sets — the catalog also includes Qto_* sets, which
        // are quantities (computed), not something to add by hand.
        const applicable = [...catalog.values()].filter(
          (p) => !p.name.startsWith("Qto_") && p.applicableEntities.some((a) => names.has(a.toUpperCase())),
        );
        if (!cancelled) setStdPsets(applicable);
      } catch {
        if (!cancelled) setStdPsets([]);
      }
    })();
    return () => { cancelled = true; };
  }, [adding, stdPsets, catalog, schema, detail.ifcClass]);

  const setRow = (gi: number, ri: number, patch: Partial<Row>) =>
    setGroups((gs) => gs.map((g, i) => (i !== gi ? g : { ...g, rows: g.rows.map((r, j) => (j !== ri ? r : { ...r, ...patch })) })));

  // Append one official property (from the pset's standard definition) to a group.
  const addOfficialProp = (gi: number, propName: string) => {
    const g = groups[gi];
    const p = catalog?.get(g.name)?.properties.find((x) => x.name === propName);
    if (!p) return;
    setGroups((gs) => gs.map((grp, i) => (i !== gi ? grp : { ...grp, rows: [...grp.rows, { name: p.name, value: "", propType: kindToType(p), orig: "", isNew: true }] })));
  };

  const addPset = (name: string, props: IfcPropertyInfo[] = []) => {
    if (!name || existingNames.has(name)) { setAdding(false); return; }
    const rows: Row[] = props.map((p) => ({ name: p.name, value: "", propType: kindToType(p), orig: "", isNew: true }));
    setGroups((gs) => [...gs, { kind: "pset", name, rows, isNew: true }]);
    setAdding(false);
  };

  const save = () => {
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.readonly || !r.name) continue;
        const changed = r.isNew ? r.value.trim() !== "" : r.value !== r.orig;
        if (!changed) continue;
        if (g.kind === "attribute") {
          // Enum attributes (PredefinedType) must serialize as `.VALUE.`.
          const out = r.isEnum ? (r.value ? `.${r.value}.` : "") : r.value;
          editor.setRootAttribute(id, r.name, out);
        } else if (g.kind === "pset") {
          editor.setProperty(id, g.name, r.name, r.value, r.propType ?? PropertyValueType.Text);
        } else {
          const num = Number(r.value.replace(",", "."));
          if (Number.isFinite(num)) editor.setQuantity(id, g.name, r.name, num, r.qtyType ?? QuantityType.Length);
        }
      }
    }
    onSaved();
  };

  return (
    <div className="edit-panel">
      {groups.map((g, gi) => (
        <div className="edit-group" key={`${g.kind}:${g.name}:${gi}`}>
          <div className="edit-group-head">
            <span className="edit-group-name">{g.name}</span>
            {g.kind === "pset" && (() => {
              // Only the pset's official buildingSMART properties not already present.
              const taken = new Set(g.rows.map((r) => r.name));
              const avail = (catalog?.get(g.name)?.properties ?? []).filter((p) => !taken.has(p.name));
              if (!avail.length) return null;
              return (
                <select
                  className="edit-mini edit-prop-picker"
                  value=""
                  title={t("edit.addOfficialProp")}
                  onChange={(e) => { if (e.target.value) addOfficialProp(gi, e.target.value); }}
                >
                  <option value="">{t("edit.addProperty")}</option>
                  {avail.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              );
            })()}
          </div>
          {g.rows.map((r, ri) => (
            <div className="edit-row" key={ri}>
              <span className="edit-k" title={r.name}>{r.name}</span>
              {r.isEnum ? (
                <select
                  className="edit-v"
                  value={r.value}
                  onChange={(e) => setRow(gi, ri, { value: e.target.value })}
                  title="PredefinedType"
                >
                  <option value="">{t("edit.undefinedEnum")}</option>
                  {[...new Set([...predefValues, ...(r.value ? [r.value] : [])].filter(Boolean))].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="edit-v"
                  value={r.value}
                  disabled={r.readonly}
                  onChange={(e) => setRow(gi, ri, { value: e.target.value })}
                />
              )}
              {g.kind === "pset" && (
                <select
                  className="edit-type"
                  value={r.propType ?? PropertyValueType.Text}
                  onChange={(e) => setRow(gi, ri, { propType: Number(e.target.value) as PropertyValueType })}
                  title={t("edit.valueType")}
                >
                  {TYPE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      ))}

      {adding ? (
        <div className="edit-add">
          <div className="edit-add-head">
            <span>{t("edit.addPset")}</span>
            <button className="edit-mini ghost" onClick={() => setAdding(false)}>{t("edit.discard")}</button>
          </div>
          <div className="edit-add-std">
            {stdPsets == null ? (
              <div className="edit-hint">{t("edit.loadingStd")}</div>
            ) : stdPsets.length === 0 ? (
              <div className="edit-hint">{t("edit.noStd")}</div>
            ) : (
              stdPsets
                .filter((p) => !existingNames.has(p.name))
                .map((p) => (
                  <button key={p.name} className="edit-std-item" title={t("edit.nProps", { n: p.properties.length })} onClick={() => addPset(p.name, [...p.properties])}>
                    {p.name} <span className="edit-std-count">({p.properties.length})</span>
                  </button>
                ))
            )}
          </div>
        </div>
      ) : (
        <button className="edit-add-btn" onClick={() => setAdding(true)}>{t("edit.addPsetBtn")}</button>
      )}

      <div className="edit-actions">
        <button className="btn" onClick={save}>{t("common.save")}</button>
        <button className="btn secondary" onClick={onCancel}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}
