import { useRef, useState } from "react";
import { parseIdsXml, runIdsValidation } from "../ifc/ids";
import type { IDSDocument, IDSValidationReport, IDSSpecificationResult, IDSEntityResult } from "../ifc/ids";
import { useI18n } from "../i18n/react";
import { ToolIcon, UiIcon } from "./icons";

interface Props {
  bytes: Uint8Array;
  fileName: string;
  report: IDSValidationReport | null;
  onReport: (r: IDSValidationReport | null) => void;
  /** Select + zoom this element in the 3D view (same tab). */
  onSelectEntity: (expressId: number) => void;
  /** Turn the current report's failures into BCF topics (optional). */
  onExportBcf?: (report: IDSValidationReport) => void;
  /** Open the IDS creator/editor modal. */
  onOpenEditor?: () => void;
  /** Promote a just-uploaded IDS to the active document (so the button becomes
   *  "Edit IDS" and the editor opens on it). */
  onDocParsed?: (doc: IDSDocument) => void;
  /** True when an authored/uploaded doc is active, so the button reads "Edit" not "Create". */
  hasActiveDoc?: boolean;
  /** Clear the active/authored IDS draft (only relevant when hasActiveDoc). */
  onDiscardDraft?: () => void;
  /** When provided, renders a close button (docked-panel mode). */
  onClose?: () => void;
}

function StatusBadge({ status }: { status: "pass" | "fail" | "not_applicable" }) {
  const { t } = useI18n();
  const label = status === "pass" ? t("ids.pass") : status === "fail" ? t("ids.fail") : t("ids.na");
  return <span className={"ids-badge ids-" + status}>{label}</span>;
}

function EntityRow({ entity, onSelect }: { entity: IDSEntityResult; onSelect: (id: number) => void }) {
  const { t } = useI18n();
  const failed = entity.requirementResults.filter((r) => r.status === "fail");
  return (
    <li className="ids-entity">
      <button className="ids-entity-head" onClick={() => onSelect(entity.expressId)} title={t("dataTable.selectIn3d")}>
        <span className="ids-entity-type">{entity.entityType}</span>
        {entity.entityName && <span className="ids-entity-name">{entity.entityName}</span>}
        {entity.globalId && <span className="ids-entity-guid">{entity.globalId}</span>}
        <span className="ids-entity-go">↦ 3D</span>
      </button>
      {failed.length > 0 && (
        <ul className="ids-reqs">
          {failed.map((r, i) => (
            <li key={i} className="ids-req">
              <div className="ids-req-desc">{r.checkedDescription}</div>
              {r.failureReason && <div className="ids-req-reason">{r.failureReason}</div>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SpecCard({
  spec,
  open,
  onToggle,
  onSelectEntity,
}: {
  spec: IDSSpecificationResult;
  open: boolean;
  onToggle: () => void;
  onSelectEntity: (id: number) => void;
}) {
  const { t } = useI18n();
  const failing = spec.entityResults.filter((e) => !e.passed);
  return (
    <div className="pacc">
      <button className="pacc-head" onClick={onToggle}>
        <span className="pacc-caret">{open ? "▾" : "▸"}</span>
        <span className="pacc-name" title={spec.specification.name}>
          {spec.specification.name}
        </span>
        <StatusBadge status={spec.status} />
        <span className="pacc-count">
          {spec.passedCount}/{spec.applicableCount}
        </span>
      </button>
      {open && (
        <div className="ids-spec-body">
          {spec.specification.description && (
            <div className="ids-spec-desc">{spec.specification.description}</div>
          )}
          {spec.cardinalityResult && !spec.cardinalityResult.passed && (
            <div className="alert warn">{spec.cardinalityResult.message}</div>
          )}
          {failing.length === 0 ? (
            <div className="ids-spec-ok">
              {spec.applicableCount === 0
                ? t("ids.noApplicable")
                : t("ids.allConform")}
            </div>
          ) : (
            <ul className="ids-entities">
              {failing.map((e) => (
                <EntityRow key={e.expressId} entity={e} onSelect={onSelectEntity} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * IDS validation panel — designed to dock on the right of the 3D viewer. Upload a
 * buildingSMART IDS (.ids), validate the loaded model, and browse per-spec results.
 * Non-conforming entities are highlighted red in the 3D view (handled by the
 * viewer from the same report); clicking a row selects + zooms to that element.
 */
export function IdsPanel({ bytes, fileName, report, onReport, onSelectEntity, onExportBcf, onOpenEditor, onDocParsed, hasActiveDoc, onDiscardDraft, onClose }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [idsName, setIdsName] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const clearReport = () => { onReport(null); setIdsName(null); setError(null); };
  const discardDraft = () => { onDiscardDraft?.(); clearReport(); setConfirmingDiscard(false); };

  const toggle = (id: string) =>
    setOpen((s) => {
      const x = new Set(s);
      x.has(id) ? x.delete(id) : x.add(id);
      return x;
    });

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setIdsName(file.name);
    setValidating(true);
    setProgress(0);
    onReport(null);
    try {
      const xml = await file.text();
      const doc = parseIdsXml(xml);
      onDocParsed?.(doc); // uploaded IDS becomes the active doc → button reads "Edit IDS"
      const r = await runIdsValidation(bytes, doc, fileName, (p) => setProgress(p.percentage));
      onReport(r);
    } catch (e: any) {
      setError(t("ids.validateError", { detail: e?.message ? `(${e.message})` : "" }));
      onReport(null);
    } finally {
      setValidating(false);
    }
  };

  const s = report?.summary;

  return (
    <div className="ids-panel">
      <div className="ids-head">
        <span className="ids-head-title"><ToolIcon kind="ids" /> {t("ids.title")}</span>
        <div className="ids-head-actions">
          {onOpenEditor && (
            <button className="ids-icon ids-create" title={t("idsEditor.title")} onClick={onOpenEditor}>
              {hasActiveDoc ? t("ids.edit") : <><span className="ids-create-plus">+</span>{t("ids.create")}</>}
            </button>
          )}
          <button className="ids-icon" title={t("ids.upload")} onClick={() => inputRef.current?.click()} disabled={validating}>
            <UiIcon kind="upload" />
          </button>
          {hasActiveDoc ? (
            <button className="ids-icon" title={t("ids.discardDraft")} onClick={() => setConfirmingDiscard(true)}>
              <UiIcon kind="trash" />
            </button>
          ) : report ? (
            <button className="ids-icon" title={t("ids.clearReport")} onClick={clearReport}>
              <UiIcon kind="trash" />
            </button>
          ) : null}
          {onClose && (
            <button className="ids-icon" title={t("common.close")} onClick={onClose}>
              ×
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".ids,.xml"
        style={{ display: "none" }}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="ids-panel-body">
        {confirmingDiscard && (
          <div className="alert error idse-confirm" role="alert">
            <span>{t("ids.confirmDiscard")}</span>
            <span style={{ flex: 1 }} />
            <button className="btn set-mini" onClick={discardDraft}>{t("ids.discard")}</button>
            <button className="btn secondary set-mini" onClick={() => setConfirmingDiscard(false)}>{t("common.cancel")}</button>
          </div>
        )}

        {!report && !validating && (
          <div className="ids-empty-state">
            <p className="ids-intro">{t("ids.intro")}</p>
            <button className="btn" onClick={() => inputRef.current?.click()}>
              {t("ids.uploadBtn")}
            </button>
          </div>
        )}

        {idsName && <div className="ids-filechip">{idsName}</div>}

        {validating && (
          <div className="ids-progress">
            <div className="ids-progress-bar" style={{ width: `${progress}%` }} />
            <span className="ids-progress-label">{t("ids.validating", { pct: Math.round(progress) })}</span>
          </div>
        )}

        {error && <div className="alert error">⛔ {error}</div>}

        {report && s && (
          <>
            <div className={"ids-overall " + (s.failedSpecifications === 0 ? "ok" : "bad")}>
              {s.failedSpecifications === 0 ? "✓" : "✕"} {s.passedSpecifications}/{s.totalSpecifications}{" "}
              {t("ids.specsConform")}
            </div>

            <div className="ids-summary">
              <div className="ids-stat">
                <span className="ids-stat-num">{s.totalEntitiesChecked}</span>
                <span className="ids-stat-lbl">{t("ids.checked")}</span>
              </div>
              <div className="ids-stat">
                <span className="ids-stat-num ids-pass-num">{s.totalEntitiesPassed}</span>
                <span className="ids-stat-lbl">{t("ids.conform")}</span>
              </div>
              <div className="ids-stat">
                <span className="ids-stat-num ids-fail-num">{s.totalEntitiesFailed}</span>
                <span className="ids-stat-lbl">{t("ids.nonconform")}</span>
              </div>
            </div>

            <div className="ids-progress slim">
              <div className="ids-progress-bar" style={{ width: `${Math.round(s.overallPassRate)}%` }} />
              <span className="ids-progress-label">{Math.round(s.overallPassRate)}%</span>
            </div>

            <div className="ids-tip">{t("ids.tip")}</div>

            {onExportBcf && s.totalEntitiesFailed > 0 && (
              <button className="btn ids-export-btn" onClick={() => onExportBcf(report)}>
                {t("ids.createBcf")}
              </button>
            )}

            <div className="ids-specs">
              {report.specificationResults.map((spec) => (
                <SpecCard
                  key={spec.specification.id}
                  spec={spec}
                  open={open.has(spec.specification.id)}
                  onToggle={() => toggle(spec.specification.id)}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
