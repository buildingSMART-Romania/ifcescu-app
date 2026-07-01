import { Modal } from "./Modal";
import { useI18n } from "../i18n/react";
import { useSettings } from "../settings/react";
import { DEFAULTS, type AreaUnit, type LengthUnit, type Projection } from "../settings/index";

/** A labelled on/off row (used for experimental toggles and viewer flags). */
function Toggle({ checked, onChange, label, desc, badge }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string; badge?: string }) {
  return (
    <label className="set-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="set-toggle-text">
        <span className="set-toggle-label">
          {label}
          {badge && <span className="set-badge">{badge}</span>}
        </span>
        {desc && <span className="set-toggle-desc">{desc}</span>}
      </span>
    </label>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const s = settings;

  return (
    <Modal
      title={t("settings.title")}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>{t("common.close")}</button>}
    >
      {/* Experimental features */}
      <section className="set-section">
        <h3 className="set-h">{t("settings.experimentalTitle")}</h3>
        <p className="set-note">{t("settings.experimentalNote")}</p>
        <Toggle
          checked={s.experimental.analytics}
          onChange={(v) => update({ experimental: { analytics: v } })}
          label={t("settings.analyticsLabel")}
          desc={t("settings.analyticsDesc")}
          badge={t("settings.badge")}
        />
      </section>

      {/* Units & formatting */}
      <section className="set-section">
        <h3 className="set-h">{t("settings.unitsTitle")}</h3>
        <div className="row">
          <div className="field">
            <label>{t("settings.unitLength")}</label>
            <select value={s.units.length} onChange={(e) => update({ units: { length: e.target.value as LengthUnit } })}>
              <option value="m">m</option>
              <option value="cm">cm</option>
              <option value="mm">mm</option>
            </select>
          </div>
          <div className="field">
            <label>{t("settings.unitArea")}</label>
            <select value={s.units.area} onChange={(e) => update({ units: { area: e.target.value as AreaUnit } })}>
              <option value="m2">m²</option>
              <option value="ha">ha</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>{t("settings.decimals")}</label>
          <select value={s.units.decimals} onChange={(e) => update({ units: { decimals: Number(e.target.value) } })}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </section>

      {/* 3D viewer */}
      <section className="set-section">
        <h3 className="set-h">{t("settings.viewerTitle")}</h3>
        <div className="set-row">
          <span>{t("settings.background")}</span>
          <span className="set-row-ctl">
            <input
              type="color"
              value={s.viewer.background ?? "#eef0f4"}
              onChange={(e) => update({ viewer: { background: e.target.value } })}
            />
            <button className="btn secondary set-mini" onClick={() => update({ viewer: { background: null } })}>
              {t("settings.reset")}
            </button>
          </span>
        </div>
        <div className="set-row">
          <span>{t("settings.selectionOutline")}</span>
          <span className="set-row-ctl">
            <input
              type="color"
              value={s.viewer.selection.outline}
              onChange={(e) => update({ viewer: { selection: { outline: e.target.value } } })}
            />
            <button className="btn secondary set-mini" onClick={() => update({ viewer: { selection: { outline: DEFAULTS.viewer.selection.outline } } })}>
              {t("settings.reset")}
            </button>
          </span>
        </div>
        <div className="set-row">
          <span>{t("settings.selectionFill")}</span>
          <span className="set-row-ctl">
            <label className="set-snap">
              <input
                type="checkbox"
                checked={s.viewer.selection.fill != null}
                onChange={(e) => update({ viewer: { selection: { fill: e.target.checked ? s.viewer.selection.outline : null } } })}
              />
              {t("settings.fillEnable")}
            </label>
            {s.viewer.selection.fill != null && (
              <input
                type="color"
                value={s.viewer.selection.fill}
                onChange={(e) => update({ viewer: { selection: { fill: e.target.value } } })}
              />
            )}
          </span>
        </div>
        <div className="set-row">
          <span />
          <span className="set-row-ctl">
            <button
              className="btn secondary set-mini"
              onClick={() => update({ viewer: { background: null, selection: { outline: DEFAULTS.viewer.selection.outline, fill: null } } })}
            >
              {t("settings.resetColors")}
            </button>
          </span>
        </div>
        <div className="field">
          <label>{t("settings.projection")}</label>
          <select value={s.viewer.projection} onChange={(e) => update({ viewer: { projection: e.target.value as Projection } })}>
            <option value="perspective">{t("settings.perspective")}</option>
            <option value="orthographic">{t("settings.orthographic")}</option>
          </select>
        </div>
        <Toggle checked={s.viewer.navCube} onChange={(v) => update({ viewer: { navCube: v } })} label={t("settings.navCube")} />
        <Toggle checked={s.viewer.viewBar} onChange={(v) => update({ viewer: { viewBar: v } })} label={t("settings.viewBar")} />
        <div className="set-row">
          <span>{t("settings.snapDefaults")}</span>
          <span className="set-row-ctl">
            {(["vertex", "midpoint", "edge", "face"] as const).map((k) => (
              <label key={k} className="set-snap">
                <input
                  type="checkbox"
                  checked={s.viewer.snap[k]}
                  onChange={(e) => update({ viewer: { snap: { [k]: e.target.checked } } })}
                />
                {t(`viewer.snap${k === "vertex" ? "Vertex" : k === "midpoint" ? "Mid" : k === "edge" ? "Edge" : "Face"}` as any)}
              </label>
            ))}
          </span>
        </div>
      </section>
    </Modal>
  );
}
