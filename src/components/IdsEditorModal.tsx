import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "./Modal";
import { useI18n } from "../i18n/react";
import type { IfcSchemaVersion } from "@ifc-lite/data";
import type { PivotModel } from "../viewer/pivot";
import {
  parseIdsXml, serializeIds, auditIds, isXsDate,
  emptyIdsDoc, emptySpec, emptyRequirement, defaultFacet,
  type IDSDocument, type IDSSpecification, type IDSFacet, type IDSConstraint,
  type IFCVersion, type RequirementOptionality, type PartOfRelation, type IDSAuditIssue,
  type IDSValidationReport,
} from "../ifc/ids";
import { hasIdsContent } from "../ifc/idsDraft";
import { ifcClasses, propertySets, dataTypes, modelCatalog } from "../ifc/idsCatalog";

// @ifc-lite/ids normalises every IFC4X3 variant to the canonical token "IFC4X3"
// (so a loaded IFC4X3_ADD2 doc parses to "IFC4X3"); we keep that internally but
// label it "IFC4X3_ADD2" in the UI and serialise it back as "IFC4X3_ADD2".
const IFC_VERSIONS: IFCVersion[] = ["IFC2X3", "IFC4", "IFC4X3"];
const versionLabel = (v: IFCVersion): string => (v === "IFC4X3" ? "IFC4X3_ADD2" : v);
const FACET_TYPES: IDSFacet["type"][] = ["entity", "attribute", "property", "classification", "material", "partOf"];
const PARTOF_RELATIONS: PartOfRelation[] = [
  "IfcRelAggregates", "IfcRelAssignsToGroup", "IfcRelContainedInSpatialStructure",
  "IfcRelNests", "IfcRelVoidsElement", "IfcRelFillsElement",
];
const OPTIONALITY: RequirementOptionality[] = ["required", "optional", "prohibited"];
const COMMON_ATTRS = ["Name", "Description", "ObjectType", "Tag", "PredefinedType", "GlobalId"];

interface Props {
  schema: IfcSchemaVersion;
  pivotModels: PivotModel[];
  /** Seed the editor with an existing document (e.g. the IDS just uploaded/
   *  validated) so it can be edited; null = start blank. */
  initialDoc?: IDSDocument | null;
  /** Validate the authored doc against the loaded model; returns the report (the
   *  editor stays open so the user can keep editing / exporting). */
  onValidate: (doc: IDSDocument) => Promise<IDSValidationReport | null>;
  /** Fires whenever the working document changes (and once on mount) so the
   *  parent can persist it as the active draft — this is what makes Close/Escape
   *  and page reload non-destructive. */
  onDocChange?: (doc: IDSDocument) => void;
  onClose: () => void;
}

interface Suggest { classes: string[]; psets: string[]; props: string[]; dataTypes: string[] }

export function IdsEditorModal({ schema, pivotModels, initialDoc, onValidate, onDocChange, onClose }: Props) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<IDSDocument>(() =>
    initialDoc && initialDoc.specifications?.length ? structuredClone(initialDoc) : emptyIdsDoc(),
  );
  const [sel, setSel] = useState(0);
  const [audit, setAudit] = useState<IDSAuditIssue[]>([]);
  const [suggest, setSuggest] = useState<Suggest>({ classes: [], psets: [], props: [], dataTypes: [] });
  const [validating, setValidating] = useState(false);
  const [valError, setValError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A New/Load action waiting for the user to confirm discarding the current doc.
  const [pending, setPending] = useState<null | { kind: "new" } | { kind: "load"; file: File }>(null);
  const [moreInfo, setMoreInfo] = useState(() => {
    const i = initialDoc?.info;
    return !!(i && (i.version || i.description || i.date || i.purpose || i.milestone || i.copyright));
  });
  const fileRef = useRef<HTMLInputElement>(null);

  // Report every doc change (and the initial one) up so the parent can autosave
  // it as the active draft. This is why closing/reloading no longer loses work.
  useEffect(() => { onDocChange?.(doc); }, [doc]);

  // Immutable update via clone-mutate-set (the doc is small).
  const update = (fn: (d: IDSDocument) => void) => setDoc((prev) => { const d = structuredClone(prev); fn(d); return d; });
  const spec = doc.specifications[Math.min(sel, doc.specifications.length - 1)];

  // Load suggestion catalogs (standard buildingSMART + current model).
  useEffect(() => {
    let live = true;
    (async () => {
      const [cls, psets, dts] = await Promise.all([ifcClasses(schema), propertySets(schema), dataTypes(schema)]);
      if (!live) return;
      const m = modelCatalog(pivotModels);
      const uniq = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();
      setSuggest({
        classes: uniq(cls, m.classes),
        psets: uniq(psets.map((p) => p.name), m.psets),
        props: uniq(psets.flatMap((p) => p.properties.map((q) => q.name)), m.properties),
        dataTypes: dts,
      });
    })();
    return () => { live = false; };
  }, [schema, pivotModels]);

  // Live audit (XSD + IFC schema + coherence) of the authored doc.
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => { auditIds(doc).then((r) => live && setAudit(r.issues)).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [doc]);

  const errs = audit.filter((i) => i.severity === "error");
  const warns = audit.filter((i) => i.severity === "warning");
  // A valid-enough doc: a title and every spec has at least one applicability
  // facet. Combined with "no audit errors", this gates Validate/Export so an
  // empty/invalid IDS can't be validated or exported.
  const structuralOk =
    !!doc.info.title?.trim() &&
    doc.specifications.length > 0 &&
    doc.specifications.every((s) => s.applicability.facets.length > 0);
  const canUse = structuralOk && errs.length === 0;

  // A stale validation error shouldn't linger after edits.
  useEffect(() => setValError(null), [doc]);

  // Validate against the model. On success the report is already in the IDS
  // panel (pushed by onValidate), so we close the editor to reveal it. On
  // failure we keep the editor open and show the error inline.
  const doValidate = async () => {
    if (!canUse) return;
    setValidating(true);
    setValError(null);
    let r: IDSValidationReport | null = null;
    try {
      r = await onValidate(doc);
    } catch (e: any) {
      setValError(t("ids.validateError", { detail: e?.message ? `(${e.message})` : "" }));
    }
    setValidating(false);
    if (r) onClose();
  };

  const doLoad = async (file: File) => {
    setLoadError(null);
    try {
      const parsed = parseIdsXml(await file.text());
      setDoc(parsed.specifications.length ? parsed : { ...parsed, specifications: [emptySpec()] });
      setSel(0);
    } catch (e: any) {
      setLoadError(t("idsEditor.loadError", { detail: e?.message ?? String(e) }));
    }
  };
  const resetDoc = () => { setDoc(emptyIdsDoc()); setSel(0); };
  // New/Load discard the current doc, so confirm first when there's content.
  const requestNew = () => { hasIdsContent(doc) ? setPending({ kind: "new" }) : resetDoc(); };
  const requestLoad = (file: File) => { hasIdsContent(doc) ? setPending({ kind: "load", file }) : doLoad(file); };
  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === "new") resetDoc();
    else doLoad(pending.file);
    setPending(null);
  };
  const doExport = () => {
    const xml = serializeIds(doc);
    const name = (doc.info.title || "specification").replace(/[^\w.-]+/g, "_");
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.ids`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Modal
      className="modal-wide"
      title={t("idsEditor.title")}
      onClose={onClose}
      footer={
        <div className="idse-foot">
          <span className={"idse-audit " + (errs.length ? "err" : warns.length ? "warn" : "ok")}>
            {errs.length || warns.length
              ? t("idsEditor.auditSummary", { e: errs.length, w: warns.length })
              : t("idsEditor.auditOk")}
          </span>
          <span className="idse-audit muted">· {t("idsEditor.autosaveNote")}</span>
          <span style={{ flex: 1 }} />
          {/* Close/Escape don't confirm: the doc is already autosaved by onDocChange. */}
          <button className="btn secondary" onClick={onClose}>{t("common.close")}</button>
          <button className="btn secondary" disabled={!canUse || validating} title={!canUse ? t("idsEditor.needContent") : undefined} onClick={doValidate}>
            {validating ? t("idsEditor.validating") : t("idsEditor.validateNow")}
          </button>
          <button className="btn" disabled={!canUse} title={!canUse ? t("idsEditor.needContent") : undefined} onClick={doExport}>{t("idsEditor.export")}</button>
        </div>
      }
    >
      <div className="idse-toolbar">
        <button className="btn secondary set-mini" onClick={requestNew}>{t("idsEditor.new")}</button>
        <button className="btn secondary set-mini" onClick={() => fileRef.current?.click()}>{t("idsEditor.load")}</button>
        <input ref={fileRef} type="file" accept=".ids,.xml" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) requestLoad(f); e.target.value = ""; }} />
      </div>

      {pending && (
        <div className="alert error idse-confirm" role="alert">
          <span>
            {pending.kind === "new"
              ? t("idsEditor.confirmNew")
              : t("idsEditor.confirmLoad", { name: pending.file.name })}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn set-mini" onClick={confirmPending}>{t("idsEditor.replace")}</button>
          <button className="btn secondary set-mini" onClick={() => setPending(null)}>{t("common.cancel")}</button>
        </div>
      )}

      {loadError && <div className="alert error" role="alert">{loadError}</div>}
      {valError && <div className="alert error" role="alert">{valError}</div>}

      {(errs.length > 0 || warns.length > 0) && (
        <ul className="idse-issues">
          {audit.slice(0, 8).map((i, k) => (
            <li key={k} className={"idse-issue " + i.severity}>{i.message}</li>
          ))}
          {audit.length > 8 && <li className="idse-issue">…</li>}
        </ul>
      )}

      <div className="idse-body">
        {/* Left: document info + spec list */}
        <div className="idse-left">
          <div className="field">
            <label>{t("idsEditor.docTitle")}</label>
            <input value={doc.info.title} placeholder={t("idsEditor.titlePh")} onChange={(e) => update((d) => { d.info.title = e.target.value; })} />
          </div>
          <div className="field">
            <label>{t("idsEditor.author")}</label>
            <input value={doc.info.author ?? ""} onChange={(e) => update((d) => { d.info.author = e.target.value || undefined; })} placeholder="email@example.com" />
            {!!doc.info.author && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(doc.info.author) && (
              <div className="idse-issue error">{t("idsEditor.authorInvalid")}</div>
            )}
          </div>

          <button className="idse-more-toggle" onClick={() => setMoreInfo((v) => !v)}>
            {moreInfo ? "▾" : "▸"} {t("idsEditor.moreInfo")}
          </button>
          {moreInfo && (
            <div className="idse-more">
              <div className="field">
                <label>{t("idsEditor.version")}</label>
                <input value={doc.info.version ?? ""} onChange={(e) => update((d) => { d.info.version = e.target.value || undefined; })} />
              </div>
              <div className="field">
                <label>{t("idsEditor.docDescription")}</label>
                <input value={doc.info.description ?? ""} onChange={(e) => update((d) => { d.info.description = e.target.value || undefined; })} />
              </div>
              <div className="field">
                <label>{t("idsEditor.date")}</label>
                <input value={doc.info.date ?? ""} placeholder={t("idsEditor.datePh")} onChange={(e) => update((d) => { d.info.date = e.target.value || undefined; })} />
                {!!doc.info.date && !isXsDate(doc.info.date) && (
                  <div className="idse-issue error">{t("idsEditor.dateInvalid")}</div>
                )}
              </div>
              <div className="field">
                <label>{t("idsEditor.purpose")}</label>
                <input value={doc.info.purpose ?? ""} onChange={(e) => update((d) => { d.info.purpose = e.target.value || undefined; })} />
              </div>
              <div className="field">
                <label>{t("idsEditor.milestone")}</label>
                <input value={doc.info.milestone ?? ""} onChange={(e) => update((d) => { d.info.milestone = e.target.value || undefined; })} />
              </div>
              <div className="field">
                <label>{t("idsEditor.copyright")}</label>
                <input value={doc.info.copyright ?? ""} onChange={(e) => update((d) => { d.info.copyright = e.target.value || undefined; })} />
              </div>
            </div>
          )}

          <div className="idse-list-head">
            <span>{t("idsEditor.specs")}</span>
            <button className="btn secondary set-mini" onClick={() => { update((d) => d.specifications.push(emptySpec())); setSel(doc.specifications.length); }}>+</button>
          </div>
          <ul className="idse-spec-list">
            {doc.specifications.map((s, i) => (
              <li key={s.id} className={"idse-spec-item" + (i === sel ? " active" : "")}>
                <button className="idse-spec-pick" onClick={() => setSel(i)}>{s.name || t("idsEditor.unnamedSpec")}</button>
                <button className="idse-spec-x" title={t("idsEditor.duplicate")} onClick={() => update((d) => { const c = structuredClone(d.specifications[i]); c.id = c.id + "-copy"; d.specifications.splice(i + 1, 0, c); })}>⧉</button>
                <button className="idse-spec-x" title={t("common.remove")} disabled={doc.specifications.length <= 1}
                  onClick={() => { update((d) => d.specifications.splice(i, 1)); setSel((x) => Math.max(0, x - (i <= x ? 1 : 0))); }}>×</button>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: selected spec */}
        {spec && <SpecForm spec={spec} suggest={suggest} update={(fn) => update((d) => fn(d.specifications[Math.min(sel, d.specifications.length - 1)]))} />}
      </div>
    </Modal>
  );
}

// --- specification form -----------------------------------------------------
function SpecForm({ spec, suggest, update }: { spec: IDSSpecification; suggest: Suggest; update: (fn: (s: IDSSpecification) => void) => void }) {
  const { t } = useI18n();
  return (
    <div className="idse-right">
      <div className="row">
        <div className="field"><label>{t("idsEditor.specName")}</label><input value={spec.name} onChange={(e) => update((s) => { s.name = e.target.value; })} /></div>
        <div className="field"><label>{t("idsEditor.identifier")}</label><input value={spec.identifier ?? ""} onChange={(e) => update((s) => { s.identifier = e.target.value || undefined; })} /></div>
      </div>
      <div className="field"><label>{t("idsEditor.description")}</label><input value={spec.description ?? ""} onChange={(e) => update((s) => { s.description = e.target.value || undefined; })} /></div>
      <div className="field">
        <label>{t("idsEditor.ifcVersions")}</label>
        <div className="idse-versions">
          {IFC_VERSIONS.map((v) => (
            <label key={v} className="set-snap">
              <input type="checkbox" checked={spec.ifcVersions.includes(v)}
                onChange={(e) => update((s) => {
                  const set = new Set(s.ifcVersions);
                  e.target.checked ? set.add(v) : set.delete(v);
                  s.ifcVersions = IFC_VERSIONS.filter((x) => set.has(x));
                })} /> {versionLabel(v)}
            </label>
          ))}
        </div>
      </div>
      {/* Applicability */}
      <FacetSection
        title={t("idsEditor.applicability")} hint={t("idsEditor.applicabilityHint")}
        facets={spec.applicability.facets} suggest={suggest}
        onAdd={(type) => update((s) => s.applicability.facets.push(defaultFacet(type)))}
        onChange={(i, f) => update((s) => { s.applicability.facets[i] = f; })}
        onRemove={(i) => update((s) => s.applicability.facets.splice(i, 1))}
      />

      {/* Requirements */}
      <div className="idse-section">
        <div className="idse-section-head">
          <span>{t("idsEditor.requirements")}</span>
          <AddFacetMenu onAdd={(type) => update((s) => s.requirements.push(emptyRequirement(defaultFacet(type))))} />
        </div>
        {spec.requirements.length === 0 && <div className="set-note">{t("idsEditor.noRequirements")}</div>}
        {spec.requirements.map((r, i) => (
          <div key={r.id} className="idse-facet">
            <div className="idse-facet-top">
              <span className="idse-facet-type">{t(`idsEditor.facet.${r.facet.type}` as any)}</span>
              <select value={r.optionality} onChange={(e) => update((s) => { s.requirements[i].optionality = e.target.value as RequirementOptionality; })}>
                {OPTIONALITY.map((o) => <option key={o} value={o}>{t(`idsEditor.opt.${o}` as any)}</option>)}
              </select>
              <span style={{ flex: 1 }} />
              <button className="idse-spec-x" title={t("common.remove")} onClick={() => update((s) => s.requirements.splice(i, 1))}>×</button>
            </div>
            <FacetEditor facet={r.facet} suggest={suggest} onChange={(f) => update((s) => { s.requirements[i].facet = f; })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FacetSection({ title, hint, facets, suggest, onAdd, onChange, onRemove }: {
  title: string; hint: string; facets: IDSFacet[]; suggest: Suggest;
  onAdd: (type: IDSFacet["type"]) => void; onChange: (i: number, f: IDSFacet) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="idse-section">
      <div className="idse-section-head"><span>{title}</span><AddFacetMenu onAdd={onAdd} /></div>
      {facets.length === 0 && <div className="set-note">{hint}</div>}
      {facets.map((f, i) => (
        <div key={i} className="idse-facet">
          <div className="idse-facet-top">
            <span className="idse-facet-type">{facetLabel(f.type)}</span>
            <span style={{ flex: 1 }} />
            <button className="idse-spec-x" onClick={() => onRemove(i)}>×</button>
          </div>
          <FacetEditor facet={f} suggest={suggest} onChange={(nf) => onChange(i, nf)} />
        </div>
      ))}
    </div>
  );
}

function facetLabel(type: IDSFacet["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function AddFacetMenu({ onAdd }: { onAdd: (type: IDSFacet["type"]) => void }) {
  const { t } = useI18n();
  return (
    <select className="idse-add" value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value as IDSFacet["type"]); e.target.value = ""; }}>
      <option value="">{t("idsEditor.addFacet")}</option>
      {FACET_TYPES.map((tp) => <option key={tp} value={tp}>{facetLabel(tp)}</option>)}
    </select>
  );
}

// --- facet editor (switches on the 6 types) ---------------------------------
function FacetEditor({ facet, suggest, onChange }: { facet: IDSFacet; suggest: Suggest; onChange: (f: IDSFacet) => void }) {
  const { t } = useI18n();
  const set = (patch: Partial<IDSFacet>) => onChange({ ...facet, ...patch } as IDSFacet);
  switch (facet.type) {
    case "entity":
      return (
        <div className="idse-fields">
          <ConstraintField label={t("idsEditor.f.className")} value={facet.name} suggestions={suggest.classes} onChange={(c) => set({ name: c ?? { type: "simpleValue", value: "" } })} />
          <ConstraintField label={t("idsEditor.f.predefinedType")} value={facet.predefinedType} optional onChange={(c) => set({ predefinedType: c })} />
        </div>
      );
    case "attribute":
      return (
        <div className="idse-fields">
          <ConstraintField label={t("idsEditor.f.attrName")} value={facet.name} suggestions={COMMON_ATTRS} onChange={(c) => set({ name: c ?? { type: "simpleValue", value: "" } })} />
          <ConstraintField label={t("idsEditor.f.value")} value={facet.value} optional onChange={(c) => set({ value: c })} />
        </div>
      );
    case "property":
      return (
        <div className="idse-fields">
          <ConstraintField label={t("idsEditor.f.pset")} value={facet.propertySet} suggestions={suggest.psets} onChange={(c) => set({ propertySet: c ?? { type: "simpleValue", value: "" } })} />
          <ConstraintField label={t("idsEditor.f.baseName")} value={facet.baseName} suggestions={suggest.props} onChange={(c) => set({ baseName: c ?? { type: "simpleValue", value: "" } })} />
          <ConstraintField label={t("idsEditor.f.dataType")} value={facet.dataType} optional suggestions={suggest.dataTypes} onChange={(c) => set({ dataType: c })} />
          <ConstraintField label={t("idsEditor.f.value")} value={facet.value} optional onChange={(c) => set({ value: c })} />
        </div>
      );
    case "classification":
      return (
        <div className="idse-fields">
          <ConstraintField label={t("idsEditor.f.system")} value={facet.system} optional onChange={(c) => set({ system: c })} />
          <ConstraintField label={t("idsEditor.f.value")} value={facet.value} optional onChange={(c) => set({ value: c })} />
        </div>
      );
    case "material":
      return (
        <div className="idse-fields">
          <ConstraintField label={t("idsEditor.f.value")} value={facet.value} optional onChange={(c) => set({ value: c })} />
        </div>
      );
    case "partOf":
      return (
        <div className="idse-fields">
          <div className="field">
            <label>{t("idsEditor.f.relation")}</label>
            <select value={facet.relation} onChange={(e) => set({ relation: e.target.value as PartOfRelation })}>
              {PARTOF_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <ConstraintField label={t("idsEditor.f.parentClass")} value={facet.entity?.name} optional suggestions={suggest.classes}
            onChange={(c) => set({ entity: c ? { type: "entity", name: c } : undefined })} />
        </div>
      );
  }
}

// --- single constraint editor (simpleValue | enumeration | pattern | bounds) -
type Kind = "any" | "simpleValue" | "enumeration" | "pattern" | "bounds";
function kindOf(c: IDSConstraint | undefined): Kind { return c ? c.type : "any"; }

function ConstraintField({ label, value, optional, suggestions, onChange }: {
  label: string; value: IDSConstraint | undefined; optional?: boolean; suggestions?: string[];
  onChange: (c: IDSConstraint | undefined) => void;
}) {
  const { t } = useI18n();
  const listId = useId();
  const kind = kindOf(value);
  const setKind = (k: Kind) => {
    if (k === "any") return onChange(undefined);
    if (k === "simpleValue") return onChange({ type: "simpleValue", value: value?.type === "simpleValue" ? value.value : "" });
    if (k === "pattern") return onChange({ type: "pattern", pattern: "" });
    if (k === "enumeration") return onChange({ type: "enumeration", values: [] });
    return onChange({ type: "bounds" });
  };
  const b = value?.type === "bounds" ? value : undefined;
  const setBound = (key: "minInclusive" | "maxInclusive" | "minExclusive" | "maxExclusive", v: string) =>
    onChange({ ...(b ?? { type: "bounds" }), [key]: v === "" ? undefined : Number(v) });

  return (
    <div className="idse-cf">
      <div className="idse-cf-head">
        <span className="idse-cf-label">{label}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {optional && <option value="any">{t("idsEditor.k.any")}</option>}
          <option value="simpleValue">{t("idsEditor.k.exact")}</option>
          <option value="enumeration">{t("idsEditor.k.enum")}</option>
          <option value="pattern">{t("idsEditor.k.pattern")}</option>
          <option value="bounds">{t("idsEditor.k.bounds")}</option>
        </select>
      </div>
      {kind === "simpleValue" && (
        <>
          <input list={suggestions?.length ? listId : undefined} value={value?.type === "simpleValue" ? value.value : ""}
            onChange={(e) => onChange({ type: "simpleValue", value: e.target.value })} />
          {suggestions?.length ? <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist> : null}
        </>
      )}
      {kind === "pattern" && (
        <input placeholder={t("idsEditor.patternPh")} value={value?.type === "pattern" ? value.pattern : ""}
          onChange={(e) => onChange({ type: "pattern", pattern: e.target.value })} />
      )}
      {kind === "enumeration" && (
        <input placeholder={t("idsEditor.enumPh")} value={value?.type === "enumeration" ? value.values.join(", ") : ""}
          onChange={(e) => onChange({ type: "enumeration", values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      )}
      {kind === "bounds" && (
        <div className="idse-bounds">
          <input type="number" placeholder="≥" value={b?.minInclusive ?? ""} onChange={(e) => setBound("minInclusive", e.target.value)} />
          <input type="number" placeholder="≤" value={b?.maxInclusive ?? ""} onChange={(e) => setBound("maxInclusive", e.target.value)} />
          <input type="number" placeholder=">" value={b?.minExclusive ?? ""} onChange={(e) => setBound("minExclusive", e.target.value)} />
          <input type="number" placeholder="<" value={b?.maxExclusive ?? ""} onChange={(e) => setBound("maxExclusive", e.target.value)} />
        </div>
      )}
    </div>
  );
}

export default IdsEditorModal;
