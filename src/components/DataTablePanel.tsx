import { useEffect, useMemo, useState } from "react";
import { DataTableConfig } from "./DataTableConfig";
import {
  buildPivot,
  discoverFields,
  displayLabel,
  exportPivotCsv,
  groupColor,
  rgbaCss,
  type PivotConfig,
  type PivotModel,
  type PivotRow,
  type Rgba,
} from "../viewer/pivot";
import { boqPresetConfig, printBoqReport } from "../viewer/boqReport";
import { useI18n } from "../i18n/react";
import { useDockResize } from "../hooks/useDockResize";

/** Monochrome line icons for the table actions (match the app's SVG style). */
function DtIcon({ kind }: { kind: "color" | "boq" | "organize" | "report" | "csv" | "table" }) {
  const a = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "table": return <svg {...a}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9.5h18M3 15h18M9 4v16" /></svg>;
    case "color": return <svg {...a}><circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" /><path d="M12 2a10 10 0 1 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h2a4 4 0 0 0 4-4 10 10 0 0 0-10-8z" /></svg>;
    case "boq": return <svg {...a}><path d="M3 17L17 3l4 4L7 21l-4 1z" /><path d="M14 6l4 4M11 9l2 2M8 12l2 2" /></svg>;
    case "organize": return <svg {...a}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1" /></svg>;
    case "report": return <svg {...a}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z" /></svg>;
    case "csv": return <svg {...a}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></svg>;
  }
}

interface Props {
  /** All federated models (the table aggregates across every loaded model). */
  models: PivotModel[];
  fileName: string;
  config: PivotConfig;
  onConfigChange: (config: PivotConfig) => void;
  /** Select the given GLOBAL ids in the 3D view (row/group click). */
  onSelectRows: (ids: number[]) => void;
  /** Paint the 3D viewer by top-level group (one color each), or null to clear. */
  onColorByGroup: (map: Map<number, Rgba> | null) => void;
  onClose: () => void;
}

/** Bottom-docked data table (pivot): grouped rows + aggregated value columns,
 *  configured via a popup. Vertically resizable; coexists with the right dock. */
export function DataTablePanel({ models, fileName, config, onConfigChange, onSelectRows, onColorByGroup, onClose }: Props) {
  const { t, lang } = useI18n();
  // Height follows the pointer position (not the drag delta) — matches the
  // original table-dock behavior; clamps preserved (min 140, top gap 160).
  const { height, startResize } = useDockResize("dockH:table", 300, { min: 140, reserve: 160, absolute: true });
  const [showConfig, setShowConfig] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [colorOn, setColorOn] = useState(false);

  const nf = useMemo(() => new Intl.NumberFormat(lang === "en" ? "en-US" : "ro-RO", { maximumFractionDigits: 2 }), [lang]);
  const fmt = (v: number | null) => (v == null ? "—" : nf.format(v));

  // lang in deps so localised field/aggregation labels rebuild on a language switch.
  const fields = useMemo(() => discoverFields(models), [models, lang]);
  const result = useMemo(() => buildPivot(models, config), [models, config, lang]);

  // Color the 3D viewer by the FIRST grouping level: each top-level row gets a
  // distinct color, applied to every element under it. Swatches double as legend.
  const coloring = useMemo(() => {
    const overrides = new Map<number, Rgba>();
    const swatches = new Map<string, string>();
    result.rows.forEach((row, i) => {
      const c = groupColor(i);
      swatches.set(row.label, rgbaCss(c));
      for (const id of row.ids) overrides.set(id, c);
    });
    return { overrides, swatches };
  }, [result]);

  // Push the override map to the viewer when active. No cleanup between re-runs:
  // flushing null before the new map caused two GPU uploads + a color flash on
  // every pivot recompute. Clear only on toggle-off (the effect body) and unmount.
  useEffect(() => {
    onColorByGroup(colorOn ? coloring.overrides : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorOn, coloring]);
  useEffect(() => {
    return () => onColorByGroup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Flatten the visible (expanded) rows into <tr>s, depth-first.
  const renderRows = (rows: PivotRow[], path: string): JSX.Element[] => {
    const out: JSX.Element[] = [];
    for (const row of rows) {
      const key = path + "/" + row.label;
      const hasChildren = row.children.length > 0;
      const open = expanded.has(key);
      out.push(
        <tr key={key} className="datatable-row" onClick={() => onSelectRows(row.ids)} title={t("dataTable.selectIn3d")}>
          <td>
            <span className="dt-cell" style={{ paddingLeft: row.depth * 16 }}>
              <span
                className="dt-caret"
                style={{ visibility: hasChildren ? "visible" : "hidden" }}
                onClick={(e) => { e.stopPropagation(); toggle(key); }}
              >
                {open ? "▾" : "▸"}
              </span>
              {colorOn && row.depth === 0 && (
                <span className="dt-swatch" style={{ background: coloring.swatches.get(row.label) }} />
              )}
              <span className="dt-label">{displayLabel(row.label)}</span>
            </span>
          </td>
          <td className="dt-num">{nf.format(row.count)}</td>
          {row.values.map((v, i) => (
            <td key={i} className="dt-num">{fmt(v)}</td>
          ))}
        </tr>,
      );
      if (hasChildren && open) out.push(...renderRows(row.children, key));
    }
    return out;
  };

  return (
    <section className="datatable-panel" style={{ height }}>
      <div className="datatable-resize" onPointerDown={startResize} title={t("viewer.resize")} />
      <div className="datatable-head">
        <span className="datatable-title"><DtIcon kind="table" /> {t("dataTable.title")}</span>
        <div className="datatable-actions">
          <button
            className={"ids-icon" + (colorOn ? " active" : "")}
            title={colorOn ? t("dataTable.colorOff") : t("dataTable.colorOn")}
            aria-label={colorOn ? t("dataTable.colorOff") : t("dataTable.colorOn")}
            onClick={() => setColorOn((c) => !c)}
          ><DtIcon kind="color" /></button>
          <button className="ids-icon" title={t("dataTable.boqPresetTitle")} aria-label={t("dataTable.boqPresetTitle")} onClick={() => onConfigChange(boqPresetConfig(fields))}><DtIcon kind="boq" /></button>
          <button className="ids-icon" title={t("dataTable.organize")} aria-label={t("dataTable.organize")} onClick={() => setShowConfig(true)}><DtIcon kind="organize" /></button>
          <button className="ids-icon" title={t("dataTable.reportTitle")} aria-label={t("dataTable.reportTitle")} onClick={() => printBoqReport(result, config, fields, fileName)}><DtIcon kind="report" /></button>
          <button className="ids-icon" title={t("dataTable.exportCsv")} aria-label={t("dataTable.exportCsv")} onClick={() => exportPivotCsv(result, config, fields, fileName)}><DtIcon kind="csv" /></button>
          <button className="ids-icon" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>×</button>
        </div>
      </div>

      <div className="datatable-body">
        {result.rows.length === 0 ? (
          <div className="datatable-empty">{t("dataTable.empty")}</div>
        ) : (
          <table className="datatable-table">
            <thead>
              <tr>
                <th>{t("dataTable.group")}</th>
                <th className="dt-num">{t("dataTable.count")}</th>
                {result.columns.map((c, i) => (
                  <th key={i} className="dt-num">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>{renderRows(result.rows, "")}</tbody>
            {config.showTotals && (
              <tfoot>
                <tr className="dt-total">
                  <td>{t("dataTable.total")}</td>
                  <td className="dt-num">{nf.format(result.totals.count)}</td>
                  {result.totals.values.map((v, i) => (
                    <td key={i} className="dt-num">{fmt(v)}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {showConfig && (
        <DataTableConfig
          fields={fields}
          config={config}
          onApply={(c) => { onConfigChange(c); setShowConfig(false); }}
          onClose={() => setShowConfig(false)}
        />
      )}
    </section>
  );
}
