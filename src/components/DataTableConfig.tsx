import { useState } from "react";
import { Modal } from "./Modal";
import { AGG_KINDS, aggLabel, type AggKind, type FieldDef, type PivotConfig, type ValueColumn } from "../viewer/pivot";
import { useI18n } from "../i18n/react";

interface Props {
  fields: FieldDef[];
  config: PivotConfig;
  onApply: (config: PivotConfig) => void;
  onClose: () => void;
}

/** Popup to organise the pivot: nested group-by row fields and aggregated value
 *  columns. Edits a draft; only commits to the parent on "Aplică". */
export function DataTableConfig({ fields, config, onApply, onClose }: Props) {
  const { t } = useI18n();
  const [groupBy, setGroupBy] = useState<string[]>(config.groupBy);
  const [values, setValues] = useState<ValueColumn[]>(config.values);
  const [showTotals, setShowTotals] = useState<boolean>(config.showTotals);

  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const available = fields.filter((f) => !groupBy.includes(f.key));
  // Aggregations other than count need a numeric field.
  const numericFields = fields.filter((f) => f.kind === "numeric");

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= groupBy.length) return;
    const next = [...groupBy];
    [next[i], next[j]] = [next[j], next[i]];
    setGroupBy(next);
  };

  const apply = () => onApply({ groupBy, values, showTotals });

  return (
    <Modal
      title={t("dataTable.configTitle")}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn" onClick={apply} disabled={!groupBy.length}>{t("common.apply")}</button>
        </>
      }
    >
      <div className="dt-cfg-section">
        <div className="dt-cfg-title">{t("dataTable.groupByRows")}</div>
        {groupBy.length === 0 && <div className="dt-cfg-hint">{t("dataTable.groupByHint")}</div>}
        {groupBy.map((key, i) => (
          <div className="dt-cfg-row" key={key}>
            <span className="dt-cfg-idx">{i + 1}.</span>
            <span className="dt-cfg-grow">{labelOf(key)}</span>
            <button className="dt-cfg-icon" title={t("common.up")} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
            <button className="dt-cfg-icon" title={t("common.down")} disabled={i === groupBy.length - 1} onClick={() => move(i, 1)}>▼</button>
            <button className="dt-cfg-icon" title={t("common.remove")} onClick={() => setGroupBy(groupBy.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
        {available.length > 0 && (
          <select
            className="dt-cfg-add"
            value=""
            onChange={(e) => e.target.value && setGroupBy([...groupBy, e.target.value])}
          >
            <option value="">{t("dataTable.addGroupField")}</option>
            {available.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="dt-cfg-section">
        <div className="dt-cfg-title">{t("dataTable.valueColumns")}</div>
        {values.length === 0 && <div className="dt-cfg-hint">{t("dataTable.noValueColumns")}</div>}
        {values.map((col, i) => {
          const field = fields.find((f) => f.key === col.fieldKey);
          return (
            <div className="dt-cfg-row" key={i}>
              <select
                className="dt-cfg-grow"
                value={col.fieldKey}
                onChange={(e) => setValues(values.map((c, k) => (k === i ? { ...c, fieldKey: e.target.value } : c)))}
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              <select
                value={col.agg}
                onChange={(e) => setValues(values.map((c, k) => (k === i ? { ...c, agg: e.target.value as AggKind } : c)))}
              >
                {AGG_KINDS.map((kind) => (
                  // Non-count aggregations only make sense on numeric fields.
                  <option key={kind} value={kind} disabled={kind !== "count" && field?.kind !== "numeric"}>
                    {aggLabel(kind)}
                  </option>
                ))}
              </select>
              <button className="dt-cfg-icon" title={t("common.remove")} onClick={() => setValues(values.filter((_, k) => k !== i))}>×</button>
            </div>
          );
        })}
        <button
          className="dt-cfg-addbtn"
          onClick={() => {
            const f = numericFields[0] ?? fields[0];
            setValues([...values, { fieldKey: f.key, agg: f.kind === "numeric" ? "sum" : "count" }]);
          }}
        >
          {t("dataTable.addColumn")}
        </button>
      </div>

      <label className="dt-cfg-check">
        <input type="checkbox" checked={showTotals} onChange={(e) => setShowTotals(e.target.checked)} />
        {t("dataTable.showTotals")}
      </label>
    </Modal>
  );
}
