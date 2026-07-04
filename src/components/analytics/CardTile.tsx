// One dashboard tile: header (drag-handle title + actions), chart body, resize
// handle, and the config popover when this tile is being edited.
import { useRef } from "react";
import { csvDownload, type FieldDef } from "../../viewer/pivot";
import { cardCsv, type ChartCard, type ChartDatum } from "../../viewer/analytics";
import { renderChart } from "./charts";
import { CardEditor } from "./CardEditor";
import { Slicer } from "./Slicer";
import { SVG_TYPES, type CardData, type RenderCtx } from "./shared";
import { exportChartPng } from "./exportPng";

interface Props {
  card: ChartCard;
  cd: CardData | undefined;
  /** Full-dimension data for the slicer (never filtered/topped). */
  slicerData: ChartDatum[] | undefined;
  ctx: RenderCtx;
  dims: FieldDef[];
  numerics: FieldDef[];
  maximized: boolean;
  editing: boolean;
  autoTitle: string;
  onStartDrag: (e: React.PointerEvent, id: string, mode: "move" | "resize") => void;
  setCard: (id: string, patch: Partial<ChartCard>) => void;
  onRemove: (id: string) => void;
  onToggleEdit: (id: string) => void;
  onToggleMax: (id: string) => void;
  onClearDim: (dimKey: string) => void;
  style?: React.CSSProperties;
}

export function CardTile({
  card, cd, slicerData, ctx, dims, numerics, maximized, editing, autoTitle,
  onStartDrag, setCard, onRemove, onToggleEdit, onToggleMax, onClearDim, style,
}: Props) {
  const { t, nf, sel } = ctx;
  const bodyRef = useRef<HTMLDivElement>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const title = card.title || autoTitle;
  const canCsv = card.type !== "slicer" && cd?.kind !== "missing";
  const canPng = SVG_TYPES.has(card.type) && cd?.kind !== "missing";

  const doCsv = () => {
    if (!cd || cd.kind === "missing") return;
    csvDownload(cardCsv(card, cd, ctx.fieldLabel), title.replace(/[^\w.-]+/g, "_") || "chart");
  };

  return (
    <div className={"an-tile" + (maximized ? " an-tile--max" : "")} style={maximized ? undefined : style}>
      <div className="an-tile-head" onPointerDown={(e) => !maximized && onStartDrag(e, card.id, "move")}>
        <span className="an-tile-title" title={title}>{title}</span>
        <span className="an-tile-actions" onPointerDown={stop}>
          <button className="an-icon-btn" title={t("analytics.configure")} onClick={() => onToggleEdit(card.id)}>⚙</button>
          {canCsv && <button className="an-icon-btn" title={t("analytics.exportCsv")} onClick={doCsv}>⇩</button>}
          {canPng && (
            <button className="an-icon-btn" title={t("analytics.exportPng")}
              onClick={() => bodyRef.current && exportChartPng(bodyRef.current, title.replace(/[^\w.-]+/g, "_"))}>
              🖼
            </button>
          )}
          <button className="an-icon-btn" title={maximized ? t("analytics.restore") : t("analytics.maximize")} onClick={() => onToggleMax(card.id)}>
            {maximized ? "🗗" : "🗖"}
          </button>
          <span className="an-tile-x" title={t("analytics.removeChart")} onClick={() => onRemove(card.id)}>×</span>
        </span>
      </div>
      <div className="an-tile-body" ref={bodyRef}>
        {card.type === "slicer" ? (
          <Slicer
            data={slicerData ?? []}
            sel={sel}
            toggle={(label) => ctx.toggle(card.dimKey, label)}
            clear={() => onClearDim(card.dimKey)}
            nf={nf}
            t={t}
          />
        ) : (
          renderChart(card, cd, ctx)
        )}
        {editing && (
          <CardEditor card={card} dims={dims} numerics={numerics} setCard={setCard} onClose={() => onToggleEdit(card.id)} t={t} />
        )}
      </div>
      {!maximized && <div className="an-tile-resize" onPointerDown={(e) => onStartDrag(e, card.id, "resize")} />}
    </div>
  );
}
