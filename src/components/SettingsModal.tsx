import { useState } from "react";
import { Modal } from "./Modal";
import { useI18n } from "../i18n/react";
import { useSettings } from "../settings/react";
import { DEFAULTS, type AreaUnit, type LengthUnit, type PivotMode, type Projection } from "../settings/index";

type SettingsTab = "units" | "viewer" | "nav" | "experimental";

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

/** A labelled speed slider row (multiplier 0.25–3, shown as a percentage). */
function Speed({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="set-row">
      <span>{label}</span>
      <span className="set-row-ctl set-speed">
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="set-speed-val">{Math.round(value * 100)}%</span>
      </span>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const s = settings;
  const [tab, setTab] = useState<SettingsTab>("units");

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "units", label: t("settings.tabUnits") },
    { id: "viewer", label: t("settings.tabViewer") },
    { id: "nav", label: t("settings.tabNav") },
    { id: "experimental", label: t("settings.tabExperimental") },
  ];

  return (
    <Modal
      title={t("settings.title")}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>{t("common.close")}</button>}
    >
      <div className="set-tabs" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.id}
            className={"set-tab" + (tab === x.id ? " active" : "")}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="set-tab-body">
      {tab === "experimental" && (
      <section className="set-section">
        <p className="set-note">{t("settings.experimentalNote")}</p>
        <Toggle
          checked={s.experimental.analytics}
          onChange={(v) => update({ experimental: { analytics: v } })}
          label={t("settings.analyticsLabel")}
          desc={t("settings.analyticsDesc")}
          badge={t("settings.badge")}
        />
      </section>
      )}

      {tab === "units" && (
      <section className="set-section">
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
      )}

      {tab === "viewer" && (
      <section className="set-section">
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
      )}

      {tab === "nav" && (
      <section className="set-section">
        <div className="field">
          <label>{t("settings.pivotMode")}</label>
          <select
            value={s.viewer.nav.pivotMode}
            onChange={(e) => update({ viewer: { nav: { pivotMode: e.target.value as PivotMode } } })}
          >
            <option value="manual">{t("settings.pivotManual")}</option>
            <option value="selection">{t("settings.pivotSelection")}</option>
            <option value="autoFrame">{t("settings.pivotAutoFrame")}</option>
          </select>
        </div>
        <p className="set-note">{t("settings.pivotModeHint")}</p>
        <Speed label={t("settings.zoomSpeed")} value={s.viewer.nav.zoomSpeed} onChange={(v) => update({ viewer: { nav: { zoomSpeed: v } } })} />
        <Speed label={t("settings.orbitSpeed")} value={s.viewer.nav.orbitSpeed} onChange={(v) => update({ viewer: { nav: { orbitSpeed: v } } })} />
        <Speed label={t("settings.panSpeed")} value={s.viewer.nav.panSpeed} onChange={(v) => update({ viewer: { nav: { panSpeed: v } } })} />
        <div className="set-row">
          <span />
          <span className="set-row-ctl">
            <button
              className="btn secondary set-mini"
              onClick={() => update({ viewer: { nav: { zoomSpeed: 1, orbitSpeed: 1, panSpeed: 1 } } })}
            >
              {t("settings.resetSpeeds")}
            </button>
          </span>
        </div>
        <Toggle
          checked={s.viewer.nav.dblClickFrame}
          onChange={(v) => update({ viewer: { nav: { dblClickFrame: v } } })}
          label={t("settings.dblClickFrame")}
        />
      </section>
      )}
      </div>
    </Modal>
  );
}
