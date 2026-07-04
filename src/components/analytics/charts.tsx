// All chart renderers for the analytics dashboard. This is the ONLY module that
// imports recharts, so the library stays inside the lazily-loaded chunk.
import {
  BarChart, Bar, PieChart, Pie, Cell, Treemap, XAxis, YAxis, ZAxis, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, AreaChart, Area, ScatterChart, Scatter,
  CartesianGrid, LabelList, RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { rgbaCss } from "../../viewer/pivot";
import {
  measureLabel,
  type ChartCard, type ChartDatum, type ScatterPoint,
} from "../../viewer/analytics";
import { datumOpacity, isDatumSelected, type CardData, type RenderCtx } from "./shared";

export const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "var(--text)",
} as const;

const AXIS_TICK = { fontSize: 11, fill: "var(--muted)" } as const;
const SMALL_TICK = { fontSize: 10, fill: "var(--muted)" } as const;

export function renderChart(card: ChartCard, cd: CardData | undefined, ctx: RenderCtx) {
  const { sel, toggle, toggleDatum, nf, t } = ctx;

  if (cd?.kind === "missing") {
    return <div className="an-empty">{t("analytics.fieldMissing", { field: cd.fieldKey })}</div>;
  }

  if (card.type === "kpi") {
    const v = cd?.kind === "kpi" ? cd.value : null;
    return (
      <div className="an-kpi-card">
        <div className="an-kpi-big">{v == null ? "–" : nf.format(v)}</div>
        <div className="an-kpi-cap">{measureLabel(card.measure, ctx.fieldLabel)}</div>
      </div>
    );
  }

  if (card.type === "gauge") {
    const v = cd?.kind === "kpi" ? cd.value : null;
    if (v == null) return <div className="an-empty">{t("analytics.noData")}</div>;
    const target = card.target && card.target > 0 ? card.target : undefined;
    const max = Math.max(target ?? v, v, 1e-9);
    const ok = target != null && v >= target;
    return (
      <div className="an-gauge">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={[{ value: v }]} startAngle={180} endAngle={0} innerRadius="70%" outerRadius="100%">
            <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
            <RadialBar
              dataKey="value"
              background
              cornerRadius={6}
              fill={ok ? "#18a06a" : "var(--accent)"}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="an-gauge-overlay">
          <div className="an-kpi-big">{nf.format(v)}</div>
          <div className="an-kpi-cap">
            {target != null ? t("analytics.ofTarget", { target: nf.format(target) }) : measureLabel(card.measure, ctx.fieldLabel)}
          </div>
        </div>
      </div>
    );
  }

  if (card.type === "stacked") {
    if (!card.stackKey) return <div className="an-empty">{t("analytics.pickStack")}</div>;
    const { rows, series } = cd?.kind === "stacked" ? cd.stacked : { rows: [], series: [] };
    if (!rows.length) return <div className="an-empty">{t("analytics.noData")}</div>;
    const lbl = (d: any) => d?.label ?? d?.payload?.label ?? "";
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={96} tick={AXIS_TICK} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(127,127,127,0.12)" }} />
          <Legend onClick={(e: any) => card.stackKey && toggle(card.stackKey, String(e?.value ?? e?.dataKey ?? ""))} wrapperStyle={{ fontSize: 11, cursor: "pointer" }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} stackId="a" fill={rgbaCss(s.color)} stroke="var(--surface)" strokeWidth={1} cursor="pointer" isAnimationActive={false} onClick={(d: any) => toggle(card.dimKey, lbl(d))} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (card.type === "scatter") {
    if (!card.measureY) return <div className="an-empty">{t("analytics.pickY")}</div>;
    const points: ScatterPoint[] = cd?.kind === "scatter" ? cd.points : [];
    if (!points.length) return <div className="an-empty">{t("analytics.noData")}</div>;
    const selOf = (label: string) => (sel && sel.length && !sel.includes(label) ? 0.25 : 1);
    const xLabel = measureLabel(card.measure, ctx.fieldLabel);
    const yLabel = measureLabel(card.measureY, ctx.fieldLabel);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" dataKey="x" name={xLabel} tick={SMALL_TICK} tickFormatter={(v: number) => nf.format(v)} />
          <YAxis type="number" dataKey="y" name={yLabel} tick={SMALL_TICK} tickFormatter={(v: number) => nf.format(v)} width={56} />
          {card.sizeMeasure && <ZAxis type="number" dataKey="size" range={[60, 400]} />}
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }: any) => {
              const p = payload?.[0]?.payload as ScatterPoint | undefined;
              if (!active || !p) return null;
              return (
                <div style={tooltipStyle as any} className="an-scatter-tip">
                  <div><b>{p.label}</b></div>
                  <div>{xLabel}: {nf.format(p.x)}</div>
                  <div>{yLabel}: {nf.format(p.y)}</div>
                  {p.size != null && card.sizeMeasure && <div>{measureLabel(card.sizeMeasure, ctx.fieldLabel)}: {nf.format(p.size)}</div>}
                </div>
              );
            }}
          />
          <Scatter data={points} cursor="pointer" isAnimationActive={false}
            onClick={(d: any) => { const l = d?.label ?? d?.payload?.label; if (l) toggle(card.dimKey, String(l)); }}>
            {points.map((p) => <Cell key={p.label} fill={rgbaCss(p.color)} fillOpacity={selOf(p.label)} stroke="var(--surface)" strokeWidth={1} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  const data: ChartDatum[] = cd?.kind === "list" ? cd.data : [];
  if (!data.length) {
    return <div className="an-empty">{card.type === "histogram" ? t("analytics.pickNumeric") : t("analytics.noData")}</div>;
  }
  const op = (d: ChartDatum) => datumOpacity(d, sel);
  const byLabel = new Map(data.map((d) => [d.label, d]));
  const clickLabel = (label: string) => {
    const d = byLabel.get(label);
    if (d) toggleDatum(selDim(card), d);
    else if (label) toggle(selDim(card), label);
  };

  if (card.type === "table") {
    const max = Math.max(...data.map((d) => d.value), 1e-9);
    return (
      <div className="an-table">
        {data.map((d, i) => (
          <button key={d.label} className={"an-table-row" + (isDatumSelected(d, sel) ? " sel" : "")} style={{ opacity: op(d) }} onClick={() => toggleDatum(selDim(card), d)}>
            <span className="an-table-rank">{i + 1}</span>
            <span className="an-table-label" title={d.label}>{d.label}</span>
            <span className="an-table-track">
              <span className="an-table-bar" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: rgbaCss(d.color) }} />
            </span>
            <span className="an-table-val">{nf.format(d.value)}</span>
          </button>
        ))}
      </div>
    );
  }

  if (card.type === "donut") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie
            data={data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%"
            isAnimationActive={false} cursor="pointer"
            label={card.showLabels ? ({ value }: any) => nf.format(value) : undefined}
            labelLine={card.showLabels ? { stroke: "var(--muted)" } : false}
            onClick={(d: any) => clickLabel(d?.name ?? d?.payload?.label ?? "")}
          >
            {data.map((d) => <Cell key={d.label} fill={rgbaCss(d.color)} fillOpacity={op(d)} stroke="var(--surface)" strokeWidth={1} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (card.type === "treemap") {
    const tm = data.map((d) => ({ name: d.label, size: d.value, fill: rgbaCss(d.color), op: op(d) }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Treemap data={tm} dataKey="size" nameKey="name" stroke="var(--surface)" isAnimationActive={false} content={<TreemapCell />} onClick={(node: any) => clickLabel(node?.name ?? "")} />
      </ResponsiveContainer>
    );
  }

  if (card.type === "line" || card.type === "area") {
    const Chart = card.type === "line" ? LineChart : AreaChart;
    const accent = "var(--accent)";
    const dot = (props: any) => {
      const d = props?.payload as ChartDatum | undefined;
      return (
        <circle
          key={props?.index ?? props?.cx}
          cx={props.cx} cy={props.cy} r={isDatumSelected(d!, sel) ? 5 : 3}
          fill={accent} fillOpacity={d ? op(d) : 1} stroke="var(--surface)" strokeWidth={1}
        />
      );
    };
    const seriesChildren = card.showLabels
      ? [<LabelList key="ll" dataKey="value" position="top" formatter={(v: any) => nf.format(Number(v))} fontSize={10} fill="var(--muted)" />]
      : [];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ left: 4, right: 12, top: card.showLabels ? 16 : 8, bottom: 28 }}
          onClick={(s: any) => { const l = s?.activeLabel; if (l != null) clickLabel(String(l)); }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--muted)" }} angle={-35} textAnchor="end" interval={0} height={40} />
          <YAxis tick={SMALL_TICK} tickFormatter={(v: number) => nf.format(v)} width={48} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} />
          {card.type === "line" ? (
            <Line type="monotone" dataKey="value" stroke={accent} strokeWidth={2} dot={dot} isAnimationActive={false} cursor="pointer">
              {seriesChildren}
            </Line>
          ) : (
            <Area type="monotone" dataKey="value" stroke={accent} strokeWidth={2} fill={accent} fillOpacity={0.18} dot={dot} isAnimationActive={false} cursor="pointer">
              {seriesChildren}
            </Area>
          )}
        </Chart>
      </ResponsiveContainer>
    );
  }

  // bar (horizontal bars) + histogram (vertical columns)
  const isBar = card.type === "bar";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={isBar ? "vertical" : "horizontal"} margin={{ left: 4, right: isBar && card.showLabels ? 44 : 12, top: 4, bottom: isBar ? 4 : 28 }}>
        {isBar ? <XAxis type="number" hide /> : <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--muted)" }} angle={-35} textAnchor="end" interval={0} height={40} />}
        {isBar ? <YAxis type="category" dataKey="label" width={100} tick={AXIS_TICK} /> : <YAxis tick={SMALL_TICK} />}
        <Tooltip cursor={{ fill: "rgba(127,127,127,0.12)" }} contentStyle={tooltipStyle} />
        <Bar dataKey="value" cursor="pointer" isAnimationActive={false} radius={isBar ? [0, 3, 3, 0] : [3, 3, 0, 0]}
          onClick={(d: any) => clickLabel(d?.label ?? d?.payload?.label ?? "")}>
          {card.showLabels && (
            <LabelList dataKey="value" position={isBar ? "right" : "top"} formatter={(v: any) => nf.format(Number(v))} fontSize={10} fill="var(--muted)" />
          )}
          {data.map((d) => <Cell key={d.label} fill={rgbaCss(d.color)} fillOpacity={op(d)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The selection dimension a list-type card's clicks toggle. */
const selDim = (c: ChartCard) => (c.type === "histogram" ? `hist:${c.histKey}` : c.dimKey);

function TreemapCell(props: any) {
  const { x, y, width, height, name, fill, op } = props;
  if (width <= 0 || height <= 0) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill ?? "#888"} fillOpacity={op ?? 1} stroke="var(--surface)" strokeWidth={1} />
      {width > 46 && height > 18 && <text x={x + 4} y={y + 14} fontSize={10} fill="#fff" style={{ pointerEvents: "none" }}>{name}</text>}
    </g>
  );
}
