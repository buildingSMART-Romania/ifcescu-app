import { Modal } from "./Modal";
import { useI18n } from "../i18n/react";
import type { I18nKey } from "../i18n";

interface Props {
  onClose: () => void;
}

/** Collapsible guide sections. `open` seeds the first one expanded. */
const SECTIONS: { titleKey: I18nKey; bodyKey: I18nKey; open?: boolean }[] = [
  { titleKey: "help.quickStartTitle", bodyKey: "help.quickStartBody", open: true },
  { titleKey: "help.nav3dTitle", bodyKey: "help.nav3dBody" },
  { titleKey: "help.treeTitle", bodyKey: "help.treeBody" },
  { titleKey: "help.propertiesTitle", bodyKey: "help.propertiesBody" },
  { titleKey: "help.editingTitle", bodyKey: "help.editingBody" },
  { titleKey: "help.toolsTitle", bodyKey: "help.toolsBody" },
  { titleKey: "help.federationTitle", bodyKey: "help.federationBody" },
  { titleKey: "help.filterTitle", bodyKey: "help.filterBody" },
  { titleKey: "help.dataTableTitle", bodyKey: "help.dataTableBody" },
  { titleKey: "help.idsBcfTitle", bodyKey: "help.idsBcfBody" },
  { titleKey: "help.globeTitle", bodyKey: "help.globeBody" },
  { titleKey: "help.clashTitle", bodyKey: "help.clashBody" },
  { titleKey: "help.analyticsTitle", bodyKey: "help.analyticsBody" },
  { titleKey: "help.settingsTitle", bodyKey: "help.settingsBody" },
  { titleKey: "help.themeLangTitle", bodyKey: "help.themeLangBody" },
];

// Keyboard shortcuts — the key glyphs are universal; only the action is translated.
const SHORTCUTS: { keys: string; descKey: I18nKey }[] = [
  { keys: "1–6", descKey: "help.shortcut.views" },
  { keys: "0", descKey: "help.shortcut.isoView" },
  { keys: "Z", descKey: "help.shortcut.fitAll" },
  { keys: "C", descKey: "help.shortcut.frame" },
  { keys: "+ / −", descKey: "help.shortcut.zoom" },
  { keys: "H", descKey: "help.shortcut.hide" },
  { keys: "L", descKey: "help.shortcut.isolate" },
  { keys: "A", descKey: "help.shortcut.showAll" },
  { keys: "S", descKey: "help.shortcut.section" },
  { keys: "O", descKey: "help.shortcut.projection" },
  { keys: "E", descKey: "help.shortcut.edit" },
  { keys: "M", descKey: "help.shortcut.measure" },
  { keys: "T", descKey: "help.shortcut.table" },
  { keys: "B", descKey: "help.shortcut.bcf" },
  { keys: "I", descKey: "help.shortcut.ids" },
  { keys: "F", descKey: "help.shortcut.filter" },
  { keys: "X", descKey: "help.shortcut.clash" },
  { keys: "/", descKey: "help.shortcut.search" },
  { keys: "Esc", descKey: "help.shortcut.escape" },
  { keys: "Del", descKey: "help.shortcut.del" },
];

/** On-demand user guide. Reuses the shared Modal (Esc/backdrop/× close). */
export function HelpModal({ onClose }: Props) {
  const { t } = useI18n();
  return (
    <Modal
      title={t("help.title")}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>{t("common.close")}</button>}
    >
      <p className="help-intro">{t("help.intro")}</p>

      {SECTIONS.map((s) => (
        <details className="help-section" key={s.titleKey} open={s.open}>
          <summary className="help-summary">{t(s.titleKey)}</summary>
          <div className="help-body">{t(s.bodyKey)}</div>
        </details>
      ))}

      <div className="help-shortcuts">
        <div className="help-shortcuts-title">{t("help.shortcutsTitle")}</div>
        <table className="help-kbd-table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td className="help-kbd-cell"><kbd className="vmenu-key">{s.keys}</kbd></td>
                <td>{t(s.descKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
