import type { ReactNode } from "react";
import { useI18n } from "../i18n/react";
import { ToolIcon, UiIcon, VisIcon } from "./icons";

interface Props {
  onFit: () => void;
  /** Frame (zoom to) the current selection. */
  onFrame: () => void;
  onHide: () => void;
  onIsolate: () => void;
  onShowAll: () => void;
  /** Toggle the length-measure tool (same as the M shortcut). */
  onMeasure: () => void;
  onSection: () => void;
  onFullscreen: () => void;
  hasSelection: boolean;
  measuring: boolean;
  section: boolean;
  fullscreen: boolean;
}

const svg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

/** Floating quick-action bar at the bottom of the 3D viewer: selection actions
 *  (frame/hide/isolate/show-all) plus the everyday tools (measure/section/
 *  projection/fullscreen). Mirrors the Z/C/H/L/A/M/S/O shortcuts. */
export function ViewBar({ onFit, onFrame, onHide, onIsolate, onShowAll, onMeasure, onSection, onFullscreen, hasSelection, measuring, section, fullscreen }: Props) {
  const { t } = useI18n();
  const btn = (title: string, onClick: () => void, icon: ReactNode, opts?: { disabled?: boolean; active?: boolean }) => (
    <button
      className={"viewbar-btn" + (opts?.active ? " active" : "")}
      title={title}
      aria-label={title}
      disabled={opts?.disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >{icon}</button>
  );
  return (
    <div className="viewbar" onMouseDown={(e) => e.stopPropagation()}>
      {btn(t("viewer.fitAll"), onFit, <UiIcon kind="fit" />)}
      {btn(t("viewer.frameSel"), onFrame, <VisIcon kind="frame" />, { disabled: !hasSelection })}
      <span className="viewbar-sep" />
      {btn(t("viewer.hideSel"), onHide, <VisIcon kind="hide" />, { disabled: !hasSelection })}
      {btn(t("viewer.isolateSel"), onIsolate, <VisIcon kind="isolate" />, { disabled: !hasSelection })}
      {btn(t("viewer.showAll"), onShowAll, <VisIcon kind="show" />)}
      <span className="viewbar-sep" />
      {btn(t("viewer.measureLength"), onMeasure, <ToolIcon kind="measure" />, { active: measuring })}
      {btn(t("viewer.sectionPlane"), onSection, <ToolIcon kind="section" />, { active: section })}
      <span className="viewbar-sep" />
      {btn(fullscreen ? t("viewbar.exitFullscreen") : t("viewbar.fullscreen"), onFullscreen,
        fullscreen
          ? svg(<path d="M9 4v3a2 2 0 0 1-2 2H4M20 9h-3a2 2 0 0 1-2-2V4M4 15h3a2 2 0 0 1 2 2v3M15 20v-3a2 2 0 0 1 2-2h3" />)
          : svg(<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />))}
    </div>
  );
}
