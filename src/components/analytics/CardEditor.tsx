// The per-tile configuration popover (gear button), replacing the crammed
// header selects. All edits flow through the shell's setCard(id, patch).
import { useEffect, useRef } from "react";
import type { FieldDef } from "../../viewer/pivot";
import { aggLabel, AGG_KINDS } from "../../viewer/pivot";
import type { AggKind } from "../../viewer/pivot";
import type { ChartCard, ChartType, Measure, SortMode } from "../../viewer/analytics";

const CHART_TYPES: ChartType[] = [
  "kpi", "gauge", "bar", "donut", "treemap", "stacked", "histogram",
  "line", "area", "table", "scatter", "slicer",
];
const SORTS: SortMode[] = ["valueDesc", "valueAsc", "labelAsc"];

const usesDim = (ty: ChartType) => ty !== "kpi" && ty !== "gauge" && ty !== "histogram";
const usesMeasure = (ty: ChartType) => ty !== "histogram" && ty !== "slicer";
const usesSortTop = (ty: ChartType) =>
  ty === "bar" || ty === "donut" || ty === "treemap" || ty === "table" || ty === "line" || ty === "area";
const usesLabels = (ty: ChartType) =>
  ty === "bar" || ty === "donut" || ty === "line" || ty === "area" || ty === "histogram";

interface Props {
  card: ChartCard;
  dims: FieldDef[];
  numerics: FieldDef[];
  setCard: (id: string, patch: Partial<ChartCard>) => void;
  onClose: () => void;
  t: (k: any, p?: any) => string;
}

/** One measure row: aggregation select + numeric field select (when agg ≠ count). */
function MeasureRow({ label, value, numerics, onChange, t }: {
  label: string;
  value: Measure | undefined;
  numerics: FieldDef[];
  onChange: (m: Measure | undefined) => void;
  t: (k: any, p?: any) => string;
}) {
  const m = value ?? { agg: "count" as AggKind };
  return (
    <div className="an-editor-row">
      <label>{label}</label>
      <span className="an-editor-ctl">
        <select
          value={m.agg}
          onChange={(e) => {
            const agg = e.target.value as AggKind;
            onChange(agg === "count" ? { agg } : { agg, fieldKey: m.fieldKey ?? numerics[0]?.key });
          }}
        >
          {AGG_KINDS.map((a) => <option key={a} value={a}>{aggLabel(a)}</option>)}
        </select>
        {m.agg !== "count" && (
          <select value={m.fieldKey ?? ""} onChange={(e) => onChange({ agg: m.agg, fieldKey: e.target.value || undefined })}>
            {!m.fieldKey && <option value="">{t("analytics.pickNumeric")}</option>}
            {numerics.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        )}
      </span>
    </div>
  );
}

export function CardEditor({ card, dims, numerics, setCard, onClose, t }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside pointer-down (same pattern as the Filter panel's combo menu).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const ty = card.type;
  return (
    <div className="an-editor" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <div className="an-editor-row">
        <label>{t("analytics.chartType")}</label>
        <span className="an-editor-ctl">
          <select value={ty} onChange={(e) => setCard(card.id, { type: e.target.value as ChartType })}>
            {CHART_TYPES.map((x) => <option key={x} value={x}>{t(("analytics.type." + x) as any)}</option>)}
          </select>
        </span>
      </div>

      <div className="an-editor-row">
        <label>{t("analytics.cardTitle")}</label>
        <span className="an-editor-ctl">
          <input
            type="text"
            value={card.title ?? ""}
            placeholder={t("analytics.titlePlaceholder")}
            onChange={(e) => setCard(card.id, { title: e.target.value || undefined })}
          />
        </span>
      </div>

      {usesDim(ty) && (
        <div className="an-editor-row">
          <label>{t("analytics.dimension")}</label>
          <span className="an-editor-ctl">
            <select value={card.dimKey} onChange={(e) => setCard(card.id, { dimKey: e.target.value })}>
              {dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </span>
        </div>
      )}

      {ty === "stacked" && (
        <div className="an-editor-row">
          <label>{t("analytics.stackBy")}</label>
          <span className="an-editor-ctl">
            <select value={card.stackKey ?? ""} onChange={(e) => setCard(card.id, { stackKey: e.target.value || undefined })}>
              <option value="">—</option>
              {dims.filter((d) => d.key !== card.dimKey).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </span>
        </div>
      )}

      {ty === "histogram" && (
        <>
          <div className="an-editor-row">
            <label>{t("analytics.pickNumeric")}</label>
            <span className="an-editor-ctl">
              <select value={card.histKey ?? ""} onChange={(e) => setCard(card.id, { histKey: e.target.value || undefined })}>
                <option value="">—</option>
                {numerics.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </span>
          </div>
          <div className="an-editor-row">
            <label>{t("analytics.bins")}</label>
            <span className="an-editor-ctl">
              <input
                type="number" min={2} max={50}
                value={card.bins ?? 10}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  setCard(card.id, { bins: Number.isFinite(n) ? Math.min(50, Math.max(2, n)) : undefined });
                }}
              />
            </span>
          </div>
        </>
      )}

      {usesMeasure(ty) && (
        <MeasureRow
          label={ty === "scatter" ? t("analytics.scatterX") : t("analytics.measure")}
          value={card.measure}
          numerics={numerics}
          onChange={(m) => setCard(card.id, { measure: m ?? { agg: "count" } })}
          t={t}
        />
      )}

      {ty === "scatter" && (
        <>
          <MeasureRow label={t("analytics.scatterY")} value={card.measureY} numerics={numerics} onChange={(m) => setCard(card.id, { measureY: m })} t={t} />
          <div className="an-editor-row">
            <label>{t("analytics.scatterSize")}</label>
            <span className="an-editor-ctl">
              <select
                value={card.sizeMeasure ? "on" : ""}
                onChange={(e) => setCard(card.id, { sizeMeasure: e.target.value ? { agg: "sum", fieldKey: numerics[0]?.key } : undefined })}
              >
                <option value="">{t("analytics.sizeNone")}</option>
                <option value="on">{aggLabel("sum")}</option>
              </select>
              {card.sizeMeasure && (
                <select
                  value={card.sizeMeasure.fieldKey ?? ""}
                  onChange={(e) => setCard(card.id, { sizeMeasure: { ...card.sizeMeasure!, fieldKey: e.target.value || undefined } })}
                >
                  {numerics.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              )}
            </span>
          </div>
        </>
      )}

      {usesSortTop(ty) && (
        <>
          <div className="an-editor-row">
            <label>{t("analytics.sortLabel")}</label>
            <span className="an-editor-ctl">
              <select value={card.sort ?? ""} onChange={(e) => setCard(card.id, { sort: (e.target.value || undefined) as SortMode | undefined })}>
                <option value="">—</option>
                {SORTS.map((s) => <option key={s} value={s}>{t(("analytics.sort." + s) as any)}</option>)}
              </select>
            </span>
          </div>
          <div className="an-editor-row">
            <label>{t("analytics.topN")}</label>
            <span className="an-editor-ctl">
              <input
                type="number" min={1} max={100}
                value={card.topN ?? ""}
                placeholder={t("analytics.topAll")}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  setCard(card.id, { topN: e.target.value && Number.isFinite(n) && n > 0 ? Math.min(100, n) : undefined });
                }}
              />
            </span>
          </div>
        </>
      )}

      {usesLabels(ty) && (
        <div className="an-editor-row">
          <label>{t("analytics.showLabels")}</label>
          <span className="an-editor-ctl">
            <input type="checkbox" checked={card.showLabels ?? false} onChange={(e) => setCard(card.id, { showLabels: e.target.checked || undefined })} />
          </span>
        </div>
      )}

      {ty === "gauge" && (
        <div className="an-editor-row">
          <label>{t("analytics.target")}</label>
          <span className="an-editor-ctl">
            <input
              type="number" min={0}
              value={card.target ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCard(card.id, { target: e.target.value && Number.isFinite(n) && n > 0 ? n : undefined });
              }}
            />
          </span>
        </div>
      )}
    </div>
  );
}
