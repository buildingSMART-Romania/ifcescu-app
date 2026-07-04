// Shared inline line-icons (24×24, currentColor stroke) used by the toolbar AND
// the panels/docks, so a dock's header icon always matches the toolbar button
// that opens it. Replaces the platform-inconsistent emoji glyphs.

const A = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export type ToolKind =
  | "section" | "ids" | "bcf" | "table" | "point" | "views" | "measure"
  | "distance" | "filter" | "analytics" | "clash" | "info";

/** Toolbar/dock icons. A dock header uses the same kind as its toolbar button. */
export function ToolIcon({ kind }: { kind: ToolKind }) {
  switch (kind) {
    case "filter": return <svg {...A}><path d="M3 4h18l-7 8.5V20l-4 1v-8.5z" /></svg>;
    case "measure": return <svg {...A}><path d="M15.3 2.3 2.3 15.3l6.4 6.4L21.7 8.7z" /><path d="M7 7l1.6 1.6M10 4l1.6 1.6M4 10l1.6 1.6M13 13l1.6 1.6" /></svg>;
    case "distance": return <svg {...A}><path d="M3 12h18" /><path d="M6 8l-3 4 3 4M18 8l3 4-3 4" /></svg>;
    case "views": return <svg {...A}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>;
    case "section": return <svg {...A}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" /></svg>;
    case "ids": return <svg {...A}><path d="M9 3h6v3H9zM7 4.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-2" /><path d="M8.5 13.5l2.2 2.2 4.3-4.6" /></svg>;
    case "bcf": return <svg {...A}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
    case "table": return <svg {...A}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9.5h18M3 15h18M9 4v16" /></svg>;
    case "point": return <svg {...A}><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="2.6" /></svg>;
    case "analytics": return <svg {...A}><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></svg>;
    case "clash": return <svg {...A}><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><path d="m6.3 6.3 2.9 2.9M14.8 14.8l2.9 2.9M17.7 6.3l-2.9 2.9M9.2 14.8l-2.9 2.9" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case "info": return <svg {...A}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>;
  }
}

/** "Vizibilitate" menu icons. */
export function VisIcon({ kind }: { kind: "hide" | "isolate" | "frame" | "show" }) {
  switch (kind) {
    case "hide": return <svg {...A}><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /><path d="M3 3l18 18" /></svg>;
    case "isolate": return <svg {...A}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /></svg>;
    case "frame": return <svg {...A}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
    case "show": return <svg {...A}><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></svg>;
  }
}

/** Preset-view menu icons (arrows + an iso cube). */
export function ViewIcon({ kind }: { kind: "iso" | "up" | "down" | "left" | "right" | "front" | "back" }) {
  switch (kind) {
    case "up": return <svg {...A}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
    case "down": return <svg {...A}><path d="M12 5v14M6 13l6 6 6-6" /></svg>;
    case "left": return <svg {...A}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
    case "right": return <svg {...A}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "front": return <svg {...A}><rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" /></svg>;
    case "back": return <svg {...A}><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>;
    case "iso": return <svg {...A}><path d="M12 2l8 4.6v9.2L12 22l-8-4.6V6.6z" /><path d="M12 11.3l8-4.6M12 11.3v10.4M12 11.3L4 6.7" /></svg>;
  }
}

/** General control icons replacing emoji glyphs on buttons/menu items. */
export function UiIcon({ kind }: { kind: "trash" | "eye" | "eyeOff" | "area" | "fit" | "upload" | "warn" | "lock" }) {
  switch (kind) {
    case "lock": return <svg {...A}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
    case "trash": return <svg {...A}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>;
    case "eye": return <svg {...A}><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></svg>;
    case "eyeOff": return <svg {...A}><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /><path d="M3 3l18 18" /></svg>;
    case "area": return <svg {...A}><rect x="3" y="3" width="18" height="18" rx="2" /></svg>;
    // Zoom-to-fit: four arrows converging on the center (distinct from the
    // fullscreen glyph's outward corner brackets).
    case "fit": return <svg {...A}><path d="M4 4l4 4M8 5V8H5M20 4l-4 4M16 5V8h3M4 20l4-4M8 19v-3H5M20 20l-4-4M16 19v-3h3" /></svg>;
    case "upload": return <svg {...A}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>;
    case "warn": return <svg {...A}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>;
  }
}
