// Bill of Quantities (antemăsurătoare) helpers built on the existing pivot layer.
// boqPresetConfig() produces a standard "group by class → material, sum the base
// quantities" configuration; printBoqReport() renders a PivotResult as a styled,
// printable HTML document (the user saves it as PDF via the browser print dialog).
import {
  displayLabel,
  fieldByKey,
  type FieldDef,
  type PivotConfig,
  type PivotResult,
  type PivotRow,
  type ValueColumn,
} from "./pivot";
import { t } from "../i18n";

// Base quantities to sum, in report order — only those present in the model are kept.
const BOQ_QUANTITIES = ["NetVolume", "GrossVolume", "NetArea", "GrossArea", "Length", "Width", "Height", "Weight"];

/** A standard BoQ pivot config: group by Class then Material, sum base quantities. */
export function boqPresetConfig(fields: FieldDef[]): PivotConfig {
  const values: ValueColumn[] = [];
  for (const name of BOQ_QUANTITIES) {
    const f = fields.find((x) => x.source === "quantity" && x.name === name);
    if (f) values.push({ fieldKey: f.key, agg: "sum" });
  }
  return { groupBy: ["class", "material"], values, showTotals: true };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const numFmt = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 });
const fmtNum = (v: number | null) => (v == null ? "" : numFmt.format(v));

/** Render the pivot as a printable HTML report and open the print dialog. */
export function printBoqReport(result: PivotResult, config: PivotConfig, fields: FieldDef[], fileName: string): void {
  const depth = config.groupBy.length;
  const groupHeaders = config.groupBy.map((k) => fieldByKey(fields, k)?.label ?? k);
  const headers = [...groupHeaders, t("dataTable.count"), ...result.columns.map((c) => c.label)];

  const bodyRows: string[] = [];
  const walk = (rows: PivotRow[], path: string[]): void => {
    for (const row of rows) {
      const labels = [...path, displayLabel(row.label)];
      if (row.children.length) {
        walk(row.children, labels);
      } else {
        const cells = [...labels];
        while (cells.length < depth) cells.push("");
        const numCells = [String(row.count), ...row.values.map(fmtNum)];
        bodyRows.push(
          "<tr>" +
            cells.map((c) => `<td>${esc(c)}</td>`).join("") +
            numCells.map((c) => `<td class="num">${esc(c)}</td>`).join("") +
            "</tr>",
        );
      }
    }
  };
  walk(result.rows, []);

  const totalCells = [String(result.totals.count), ...result.totals.values.map(fmtNum)];
  const totalRow = config.showTotals
    ? `<tr class="total"><td colspan="${depth}">${esc(t("dataTable.total"))}</td>` +
      totalCells.map((c) => `<td class="num">${esc(c)}</td>`).join("") +
      "</tr>"
    : "";

  const date = new Date().toLocaleDateString("ro-RO");
  const html = `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8">
<title>${esc(t("boq.title"))} — ${esc(fileName)}</title>
<style>
  body { font-family: system-ui, Arial, sans-serif; color: #1a1a1a; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #f0f0f0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; background: #f7f7f7; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>${esc(t("boq.title"))}</h1>
<div class="meta">${esc(fileName)} — ${esc(t("boq.generated"))} ${esc(date)}</div>
<table>
  <thead><tr>${headers.map((h, i) => `<th class="${i >= depth ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${bodyRows.join("")}</tbody>
  ${totalRow ? `<tfoot>${totalRow}</tfoot>` : ""}
</table>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return; // popup blocked
  w.document.write(html);
  w.document.close();
  w.focus();
  // Let the new document lay out before invoking print.
  setTimeout(() => w.print(), 200);
}
