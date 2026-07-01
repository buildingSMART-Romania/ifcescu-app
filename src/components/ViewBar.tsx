import type { ReactNode } from "react";
import { useI18n } from "../i18n/react";

interface Props {
  onHome: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFullscreen: () => void;
  fullscreen: boolean;
}

const svg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

/** Floating quick-action bar at the bottom of the 3D viewer. */
export function ViewBar({ onHome, onFit, onZoomIn, onZoomOut, onFullscreen, fullscreen }: Props) {
  const { t } = useI18n();
  const btn = (title: string, onClick: () => void, icon: ReactNode) => (
    <button className="viewbar-btn" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}>{icon}</button>
  );
  return (
    <div className="viewbar" onMouseDown={(e) => e.stopPropagation()}>
      {btn(t("viewbar.home"), onHome, svg(<><path d="M3 11l9-8 9 8" /><path d="M5 9v11h14V9" /></>))}
      {btn(t("viewer.fitAll"), onFit, svg(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>))}
      <span className="viewbar-sep" />
      {btn(t("viewbar.zoomIn"), onZoomIn, svg(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></>))}
      {btn(t("viewbar.zoomOut"), onZoomOut, svg(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></>))}
      <span className="viewbar-sep" />
      {btn(fullscreen ? t("viewbar.exitFullscreen") : t("viewbar.fullscreen"), onFullscreen,
        fullscreen
          ? svg(<path d="M9 4v3a2 2 0 0 1-2 2H4M20 9h-3a2 2 0 0 1-2-2V4M4 15h3a2 2 0 0 1 2 2v3M15 20v-3a2 2 0 0 1 2-2h3" />)
          : svg(<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />))}
    </div>
  );
}
