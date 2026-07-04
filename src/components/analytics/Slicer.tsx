// Slicer visual: a searchable checkbox list over one categorical dimension.
// It drives the SAME cross-filter `selected` record as chart clicks — it is just
// a direct way to pick categories. Deliberately not self-excluding, so the list
// always shows the full dimension with its current selection state.
import { useState } from "react";
import { rgbaCss } from "../../viewer/pivot";
import { slicerValues, type ChartDatum } from "../../viewer/analytics";

interface Props {
  /** Full-dimension data (from the shell's dataByDim — never filtered/topped). */
  data: ChartDatum[];
  sel: string[] | undefined;
  toggle: (label: string) => void;
  clear: () => void;
  nf: Intl.NumberFormat;
  t: (k: any, p?: any) => string;
}

export function Slicer({ data, sel, toggle, clear, nf, t }: Props) {
  const [query, setQuery] = useState("");
  const { items, more } = slicerValues(data, query);
  return (
    <div className="an-slicer">
      <div className="an-slicer-top">
        <input
          type="search"
          value={query}
          placeholder={t("analytics.slicerSearch")}
          onChange={(e) => setQuery(e.target.value)}
        />
        {sel && sel.length > 0 && (
          <button className="an-clear" onClick={clear}>{t("analytics.slicerClear")}</button>
        )}
      </div>
      <div className="an-slicer-list">
        {items.map((d) => (
          <label key={d.label} className="an-slicer-row">
            <input type="checkbox" checked={sel?.includes(d.label) ?? false} onChange={() => toggle(d.label)} />
            <span className="an-slicer-dot" style={{ background: rgbaCss(d.color) }} />
            <span className="an-slicer-label" title={d.label}>{d.label}</span>
            <span className="an-slicer-count">{nf.format(d.value)}</span>
          </label>
        ))}
        {!items.length && <div className="an-empty">{t("analytics.noData")}</div>}
        {more > 0 && <div className="an-slicer-more">{t("analytics.slicerMore", { n: more })}</div>}
      </div>
    </div>
  );
}
