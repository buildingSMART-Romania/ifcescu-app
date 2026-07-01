// Theme-aware colors for the 3D overlays (measure, alignment, parcels). The
// overlays are drawn as SVG with JS-set attributes, so they can't use CSS classes;
// instead they read the app's CSS custom properties here. Values are cached per
// theme (invalidated when <html data-theme> changes), so reading them every frame
// is cheap. We build the accent from --accent-rgb (a literal triplet) to avoid
// relying on nested var() resolution.
let cacheTheme = "";
const cache: Record<string, string> = {};

function cssVar(name: string, fallback: string): string {
  const theme = document.documentElement.getAttribute("data-theme") || "light";
  if (theme !== cacheTheme) {
    cacheTheme = theme;
    for (const k in cache) delete cache[k];
  }
  if (cache[name] === undefined) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache[name] = v || fallback;
  }
  return cache[name];
}

export const ovc = {
  accentRgb: () => cssVar("--accent-rgb", "230, 0, 126"),
  accent: () => `rgb(${ovc.accentRgb()})`,
  accentFill: (a: number) => `rgba(${ovc.accentRgb()}, ${a})`,
  /** Secondary brand color, used to tell the "B" pickers apart from the "A" accent. */
  teal: () => cssVar("--bs-teal", "#00a0af"),
  /** Calm neutral for idle parcel outlines etc. */
  muted: () => cssVar("--muted", "#6b7280"),
  /** Dark translucent chip background for on-scene labels (reads in both themes). */
  chip: "rgba(28, 32, 44, 0.85)",
};
