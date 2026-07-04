import { Fragment, useRef, useState } from "react";
import { useI18n } from "../i18n/react";
import { UiIcon } from "./icons";

interface ModelRow {
  id: string;
  fileName: string;
  primary: boolean;
  visible: boolean;
  schema: string;
}

interface Props {
  models: ModelRow[];
  busy?: boolean;
  onToggleVisible: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void; // not offered for the primary model in v1
  onAddModel: (file: File) => void;
  colorByModel: boolean;
  onColorByModel: (on: boolean) => void;
  /** Fixed pixel height once the user has dragged the resizer; null = auto (CSS-capped). */
  height?: number | null;
}

/** "Modele" section at the top of the left panel: lists federated models with a
 *  visibility toggle and remove (×), plus an "Adaugă model" button and a
 *  "color by model" toggle. */
export function ModelsPanel({ models, busy, onToggleVisible, onRemove, onAddModel, colorByModel, onColorByModel, height }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  // Two-step remove (same pattern as BcfPanel's topic delete): the × only arms
  // the inline confirm strip; removal happens on the explicit confirm button.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <div
      className="models-panel"
      style={height != null ? { height, maxHeight: "none", flex: "0 0 auto" } : undefined}
    >
      <div className="models-head">
        <span>{t("models.head", { n: models.length })}</span>
        <button className="models-add" onClick={() => inputRef.current?.click()} disabled={busy} title={t("models.addTitle")}>
          {t("models.add")}
        </button>
      </div>
      {models.length > 1 && (
        <label className="models-colorby" title={t("models.colorByModelTitle")}>
          <input type="checkbox" checked={colorByModel} onChange={(e) => onColorByModel(e.target.checked)} />
          <span>{t("models.colorByModel")}</span>
        </label>
      )}
      <div className="models-list">
        {models.map((m) => (
          <Fragment key={m.id}>
          <div className="models-row">
            <span className="models-status" title={t("models.loaded")} />
            <span
              className="models-eye"
              role="button"
              tabIndex={0}
              title={m.visible ? t("models.hide") : t("models.show")}
              aria-label={m.visible ? t("models.hide") : t("models.show")}
              onClick={() => onToggleVisible(m.id, !m.visible)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleVisible(m.id, !m.visible); } }}
            >
              <UiIcon kind={m.visible ? "eye" : "eyeOff"} />
            </span>
            <span className="models-name" title={m.fileName}>
              {m.fileName}{m.primary ? " ★" : ""}
            </span>
            {m.schema && <span className="models-badge" title={t("models.schemaBadge")}>{m.schema}</span>}
            {!m.primary && (
              <span
                className="models-rm"
                role="button"
                tabIndex={0}
                title={t("models.remove")}
                aria-label={t("models.remove")}
                onClick={() => setConfirmId(m.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setConfirmId(m.id); } }}
              >×</span>
            )}
          </div>
          {confirmId === m.id && (
            <div className="models-confirm">
              <span>{t("models.confirmRemove")}</span>
              <button className="btn small danger" onClick={() => { setConfirmId(null); onRemove(m.id); }}>{t("models.remove")}</button>
              <button className="btn small secondary" onClick={() => setConfirmId(null)}>{t("common.cancel")}</button>
            </div>
          )}
          </Fragment>
        ))}
      </div>
      {busy && <div className="models-busy">{t("common.loading")}</div>}
      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onAddModel(f);
          e.currentTarget.value = ""; // allow re-adding the same file after removal
        }}
      />
    </div>
  );
}
