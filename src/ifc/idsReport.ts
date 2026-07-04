// IDS validation report exports — the exam deliverables. Pure builders over an
// IDSValidationReport (whose checkedDescription/failureReason strings arrive
// pre-translated from the validator), so both are unit-testable in node:
//   idsReportHtml() → printable document (browser print dialog → PDF)
//   idsReportCsv()  → flat rows, one per failed requirement per entity
// printIdsReport() mirrors printBoqReport's window.open/print mechanism.
import { csvCell } from "../viewer/pivot";
import { t, getLang } from "../i18n";
import type { IDSValidationReport, IDSSpecificationResult, IDSEntityResult } from "./ids";

/** Cap the failing-entity rows PER SPEC in the printable report so a huge model
 *  can't produce an unprintable document. The CSV stays complete — it is the
 *  data deliverable; the PDF is the human-readable evidence. */
const HTML_MAX_ENTITIES_PER_SPEC = 500;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const statusLabel = (status: IDSSpecificationResult["status"]): string =>
  status === "pass" ? t("ids.pass") : status === "fail" ? t("ids.fail") : t("ids.na");

const failingEntities = (spec: IDSSpecificationResult): IDSEntityResult[] =>
  spec.entityResults.filter((e) => !e.passed);

const pct = (v: number): string => `${Math.round(v)}%`;

/** Flat CSV lines (header + rows). One row per failed requirement per failing
 *  entity; specs without failures collapse to a single summary row. */
export function idsReportCsv(report: IDSValidationReport): string[] {
  const header = [
    t("ids.report.spec"), t("ids.report.status"), t("ids.report.passRate"),
    t("ids.report.entity"), t("ids.report.name"), t("ids.report.globalId"),
    t("ids.report.requirement"), t("ids.report.reason"),
    t("ids.report.expected"), t("ids.report.actual"),
  ];
  const lines = [header.map(csvCell).join(",")];
  const row = (cells: string[]) => lines.push(cells.map(csvCell).join(","));

  for (const spec of report.specificationResults) {
    const name = spec.specification.name;
    const status = statusLabel(spec.status);
    const rate = pct(spec.passRate);
    const failing = failingEntities(spec);
    if (!failing.length) {
      row([name, status, rate, "", "", "", "", "", "", ""]);
      continue;
    }
    for (const e of failing) {
      for (const r of e.requirementResults) {
        if (r.status !== "fail") continue;
        row([
          name, status, rate,
          e.entityType, e.entityName ?? "", e.globalId ?? "",
          r.checkedDescription, r.failureReason ?? "",
          r.expectedValue ?? "", r.actualValue ?? "",
        ]);
      }
    }
  }
  return lines;
}

/** The complete printable HTML document (self-contained inline styles). */
export function idsReportHtml(report: IDSValidationReport): string {
  const lang = getLang();
  const locale = lang === "en" ? "en-US" : "ro-RO";
  const s = report.summary;
  const title = report.document.info.title || "IDS";
  const date = new Date(report.timestamp).toLocaleString(locale);
  const passColor = "#18a06a", failColor = "#e0524f", naColor = "#888";
  const badge = (status: IDSSpecificationResult["status"]): string => {
    const c = status === "pass" ? passColor : status === "fail" ? failColor : naColor;
    return `<span class="badge" style="background:${c}">${esc(statusLabel(status))}</span>`;
  };

  const specSections = report.specificationResults.map((spec) => {
    const failing = failingEntities(spec);
    const head =
      `<div class="spec-head"><h2>${esc(spec.specification.name)}</h2>${badge(spec.status)}` +
      `<span class="spec-counts">${spec.passedCount}/${spec.applicableCount} · ${esc(pct(spec.passRate))}</span></div>` +
      (spec.specification.description ? `<div class="spec-desc">${esc(spec.specification.description)}</div>` : "") +
      (spec.cardinalityResult && !spec.cardinalityResult.passed
        ? `<div class="card-warn">${esc(spec.cardinalityResult.message ?? "")}</div>`
        : "");

    if (!failing.length) {
      const note = spec.status === "not_applicable" ? t("ids.noApplicable") : t("ids.allConform");
      return `<section>${head}<div class="spec-ok">${esc(note)}</div></section>`;
    }

    const shown = failing.slice(0, HTML_MAX_ENTITIES_PER_SPEC);
    const rows: string[] = [];
    for (const e of shown) {
      const fails = e.requirementResults.filter((r) => r.status === "fail");
      fails.forEach((r, i) => {
        const entityCells =
          i === 0
            ? `<td rowspan="${fails.length}">${esc(e.entityType)}</td>` +
              `<td rowspan="${fails.length}">${esc(e.entityName ?? "")}</td>` +
              `<td rowspan="${fails.length}" class="mono">${esc(e.globalId ?? "")}</td>`
            : "";
        rows.push(
          `<tr>${entityCells}<td>${esc(r.checkedDescription)}</td><td>${esc(r.failureReason ?? "")}</td>` +
            `<td>${esc(r.expectedValue ?? "")}</td><td>${esc(r.actualValue ?? "")}</td></tr>`,
        );
      });
    }
    const more =
      failing.length > shown.length
        ? `<div class="more">${esc(t("ids.report.more", { n: failing.length - shown.length }))}</div>`
        : "";
    return (
      `<section>${head}<table><thead><tr>` +
      `<th>${esc(t("ids.report.entity"))}</th><th>${esc(t("ids.report.name"))}</th><th>${esc(t("ids.report.globalId"))}</th>` +
      `<th>${esc(t("ids.report.requirement"))}</th><th>${esc(t("ids.report.reason"))}</th>` +
      `<th>${esc(t("ids.report.expected"))}</th><th>${esc(t("ids.report.actual"))}</th>` +
      `</tr></thead><tbody>${rows.join("")}</tbody></table>${more}</section>`
    );
  });

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(t("ids.report.heading"))} — ${esc(title)}</title>
<style>
  body { font-family: system-ui, Arial, sans-serif; color: #1a1a1a; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 0; display: inline; }
  .meta { color: #666; font-size: 12px; margin-bottom: 14px; }
  .summary { display: flex; gap: 18px; align-items: center; margin-bottom: 6px; font-size: 13px; }
  .summary b { font-size: 16px; }
  .bar { height: 8px; background: #eee; border-radius: 4px; overflow: hidden; margin: 4px 0 18px; }
  .bar > div { height: 100%; background: ${"#18a06a"}; }
  section { margin-bottom: 18px; page-break-inside: avoid; }
  .spec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .spec-counts { color: #666; font-size: 12px; }
  .spec-desc { color: #444; font-size: 12px; margin-bottom: 6px; }
  .spec-ok { color: #18a06a; font-size: 12px; }
  .card-warn { color: #d98330; font-size: 12px; margin-bottom: 6px; }
  .badge { color: #fff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
  .more { color: #666; font-size: 11px; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 10px; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>${esc(t("ids.report.heading"))} — ${esc(title)}</h1>
<div class="meta">${esc(t("ids.report.model"))}: ${esc(report.modelInfo.modelId)} · ${esc(t("ids.report.schema"))}: ${esc(report.modelInfo.schemaVersion)} · ${esc(t("ids.report.elements"))}: ${report.modelInfo.entityCount} · ${esc(t("boq.generated"))} ${esc(date)}</div>
<div class="summary">
  <span><b>${s.passedSpecifications}/${s.totalSpecifications}</b> ${esc(t("ids.specsConform"))}</span>
  <span>${esc(t("ids.checked"))}: <b>${s.totalEntitiesChecked}</b></span>
  <span style="color:${"#18a06a"}">${esc(t("ids.conform"))}: <b>${s.totalEntitiesPassed}</b></span>
  <span style="color:${"#e0524f"}">${esc(t("ids.nonconform"))}: <b>${s.totalEntitiesFailed}</b></span>
  <span>${esc(pct(s.overallPassRate))}</span>
</div>
<div class="bar"><div style="width:${Math.max(0, Math.min(100, s.overallPassRate))}%"></div></div>
${specSections.join("")}
</body></html>`;
}

/** Open the printable report in a new window and invoke the print dialog. */
export function printIdsReport(report: IDSValidationReport): void {
  const w = window.open("", "_blank");
  if (!w) return; // popup blocked
  w.document.write(idsReportHtml(report));
  w.document.close();
  w.focus();
  // Let the new document lay out before invoking print.
  setTimeout(() => w.print(), 200);
}
