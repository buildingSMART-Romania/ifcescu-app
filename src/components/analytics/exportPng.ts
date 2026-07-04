// Per-chart PNG export: serialize one recharts <svg> to a canvas and download.
// CSS custom properties (var(--muted) on axis ticks, var(--surface) strokes…)
// don't survive XMLSerializer, so each var()-valued fill/stroke is resolved to
// its computed color on a parallel walk of the original vs. cloned tree.
// Whole-dashboard export was deliberately rejected: tiles mix HTML and SVG.

function resolveCssVars(original: Element, clone: Element): void {
  const attrs = ["fill", "stroke", "stop-color"] as const;
  const walk = (o: Element, c: Element) => {
    for (const a of attrs) {
      const v = c.getAttribute(a);
      if (v && v.includes("var(")) {
        const computed = getComputedStyle(o).getPropertyValue(a === "stop-color" ? "stop-color" : a);
        if (computed) c.setAttribute(a, computed);
      }
    }
    // style="" attributes can carry var() too (recharts tooltip/label styles).
    const style = c.getAttribute("style");
    if (style && style.includes("var(")) {
      const cs = getComputedStyle(o);
      c.setAttribute("style", style.replace(/var\((--[\w-]+)\)/g, (_, name) => cs.getPropertyValue(name).trim() || "#888"));
    }
    const oc = o.children, cc = c.children;
    for (let i = 0; i < oc.length && i < cc.length; i++) walk(oc[i], cc[i]);
  };
  walk(original, clone);
}

/** Export the first SVG inside `host` as a PNG download named `<base>.png`. */
export function exportChartPng(host: HTMLElement, baseName: string): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Default the text font from the live chart so labels keep the app's face.
  clone.style.fontFamily = getComputedStyle(svg).fontFamily;
  resolveCssVars(svg, clone);

  const xml = new XMLSerializer().serializeToString(clone);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(3, window.devicePixelRatio || 1) * 2; // crisp export
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const cx = canvas.getContext("2d");
    if (!cx) return;
    // Theme surface as the background (transparent PNGs read badly in docs).
    const surface = getComputedStyle(svg).getPropertyValue("--surface").trim() || "#ffffff";
    cx.fillStyle = surface;
    cx.fillRect(0, 0, canvas.width, canvas.height);
    cx.scale(scale, scale);
    cx.drawImage(img, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `${baseName}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    }, "image/png");
  };
  img.src = url;
}
