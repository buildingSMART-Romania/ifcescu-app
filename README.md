# IFCescu

A fully client-side web app to **view and edit IFC building models** in the
browser. Inspect a model in an interactive WebGPU 3D viewer, edit element
attributes and property/quantity values **directly in the 3D view**, add property
sets (standard buildingSMART psets or custom ones), validate against **IDS**,
review **BCF** topics, build pivot **data tables**, run **clash detection**, and
place the model on a 3D **globe** in real-world context — then export an edited,
non-destructive `.ifc`. A **Settings** dialog tunes units/formatting and the 3D
viewer, and gates experimental features.

Everything runs **in the browser**: there is no backend, so it can be hosted as a
static site (e.g. GitHub Pages). IFC parsing, geometry, mutation and export are
handled by [**@ifc-lite**](https://github.com/LTplus-AG/ifc-lite) (a Rust → WebAssembly
core), 3D rendering by **`@ifc-lite/renderer`** (WebGPU), and the globe by
[**CesiumJS**](https://cesium.com/platform/cesiumjs/). Globe placement targets the
Romanian national projection **Stereo 70 (EPSG:3844)** with vertical datum
**Marea Neagră 1975**.

Built with **Vite + React + TypeScript** and the buildingSMART colour palette with
a light/dark theme toggle. The UI ships in **Romanian (default)** and **English**,
switchable at runtime from a button in the top-right (the choice is remembered).

> ⚠️ **The 3D viewer requires WebGPU** (recent Chrome/Edge, or Safari 18+). The app
> gates on `navigator.gpu` and shows a notice when it's unavailable — **data
> editing, export, and the Cesium globe still work** without WebGPU.

> ℹ️ **The `@ifc-lite` core is a prebuilt npm dependency**, not source in this repo.
> There is **no Rust toolchain, `wasm-pack`, or shader build** here — `npm install`
> pulls the prebuilt `.wasm` and WebGPU/WGSL assets from the `@ifc-lite/*` packages.
> To change the core itself, work in the upstream
> [`LTplus-AG/ifc-lite`](https://github.com/LTplus-AG/ifc-lite) repo and bump the
> versions in `package.json`.

## Features

- **In-view editing** — select an element and edit it in place: IfcRoot attributes
  (Name, Description, ObjectType, Tag) and existing property/quantity values across
  its psets and `Qto_*` sets. Add a property to an existing pset, or add a whole pset
  — standard class psets (the `Pset_*` applicable to the element's IFC class and its
  supertypes, from `@ifc-lite/data`) or custom ones. Edits apply to an in-memory
  overlay; **non-destructive export** (`@ifc-lite/export`) rewrites only the entities
  you touched and preserves every other record with full numeric precision.
- **3D viewer (WebGPU)** — streaming geometry load, click-to-select with a lime
  silhouette outline, and a resizable properties panel (grouped psets, `Qto_*` last,
  pin favourites, and a model overview + OpenStreetMap location card when nothing is
  selected).
- **Model federation** — load multiple IFC models into one scene via the **Modele**
  panel; the first (**primary ★**) sets the origin and the rest are placed by their
  georeference offset. The tree, selection, properties, editing and data table work
  across all loaded models; globe, IDS and BCF operate on the primary. A **color by
  model** toggle paints each model a distinct color to tell them apart.
- **Structure tree** — Spatial / Class / Material tabs, one root per model, elements
  grouped by class, with a **search field** that filters by name or class and
  auto-expands the matches. The panel **auto-fits its width** to the longest visible
  label (grow-only, capped) so deep/long names are not truncated; still resizable by hand.
- **Measure** — length / point / area with selectable object snapping (endpoint,
  midpoint, edge, face); the point tool reports IFC X/Y/Z and Stereo 70 E/N/H when
  georeferenced. Length/area readouts follow the unit + decimal settings.
- **Section** — a single clip plane created by double-clicking a face, with a
  draggable handle and size/flip controls.
- **Saved views** — store the current camera and visibility from the **Views** menu and
  return to them anytime; the list is remembered per file in `localStorage`.
- **Data table (pivot)** — docked, resizable table that groups elements by
  Model / class / material / property / quantity and aggregates value columns
  (sum/avg/count/min/max), with row→3D selection and CSV export. A **bill-of-quantities**
  preset groups by class → material and sums the base quantities, and a **printable
  report** opens a styled page you can save as PDF.
- **Analytics dashboard (Power BI-style, experimental, off by default)** — enable it in Settings; it opens a
  **resizable bottom dock** (the 3D stays visible above) with movable, resizable visuals (bars, donut, treemap,
  stacked bars by two dimensions, quantity histogram, KPI cards) over any dimension (class, material, property,
  quantity) with count or sum measures, built on the same pivot layer. Clicking a category **cross-filters every
  other visual** (they recompute) **and** the 3D viewer (isolates + colors the matching elements; OR within a
  chart, AND across charts). A dependency-free drag/resize grid; charts via Recharts — lazy-loaded so it stays
  out of the initial bundle.
- **Clash detection** — a toolbar button opens a **resizable bottom
  dock** (the 3D stays visible above) that checks **geometric interference** between two element sets (**Set A x
  Set B**, by model). It finds **hard clashes** (overlapping geometry) and **clearance clashes** (gap below a
  threshold) with a grid-accelerated AABB broad phase, and an optional **triangle-triangle narrow phase**
  (Moller test) that confirms real interference, **ignores mere surface contact** (e.g. a beam resting on a
  slab) and reports the **true penetration** depth (not the inflated bounding-box overlap). Clicking a clash
  **isolates, colors (A red / B orange) and frames the interference region** in 3D; each clash carries a
  **status** (new/active/resolved/approved/ignored) persisted per file-set in `localStorage`. **Send to BCF**
  creates one topic + viewpoint per clash (camera framed on the clash, the two elements isolated + colored) and
  opens the BCF panel to export the `.bcfzip`; results also **export to CSV**. Set A / Set B are multi-select
  dropdowns. Pure client-side, built on the engine's retained per-element bounds and geometry; the panel is
  lazy-loaded.
- **Filter & select** — a rule-based query builder (IFC type *is one of*, property
  `pset.name operator value`, or name contains/equals/regex) combined with AND/OR; Run
  to **select or isolate** the matches in 3D.
- **IDS** — validate the primary model against an uploaded IDS specification, **and author
  IDS in-app**: the IDS creator (✎) builds specifications across all six facets
  (Entity/Attribute/Property/Classification/Material/PartOf), exports a `.ids`, loads an
  existing one to edit, and validates directly against the model.
- **BCF** — full topic collaboration: create topics from the current view, **add comments** (optionally
  with the current view attached), **edit status / type / priority / assignee / due date**, and **delete**
  topics; import/export `.bcfzip`; and **open a topic's viewpoint** (↗ 3D) to reproduce it in 3D — camera
  + isolation + coloring + selection (so topics generated from IDS validation or clash detection restore
  their exact view), with a **Reset the view** button that returns the model to a neutral state (full
  visibility, no isolation/coloring/selection, including the IDS overlay). BCF enum values are kept
  verbatim for round-trip fidelity.
- **Globe (Cesium)** — place georeferenced models (or models already in real Stereo 70
  coordinates) on a token-free 3D world map with OSM/Esri basemaps, terrain, and an
  earth-transparency slider; a bundled **EGM2008** geoid grid provides the geoid
  undulation readout.
- **Settings** — a gear-button dialog (saved to `localStorage`): **experimental
  features** (gates the analytics module — off by default), **units & formatting**
  (length m/cm/mm, area m²/ha, decimals), **3D viewer** (background, projection
  perspective/orthographic, navigation cube, view bar, default snapping), and
  **navigation** (orbit-pivot mode — manual / orbit-around-selection / auto-frame,
  zoom/orbit/pan speeds, double-click framing).
- **Navigation** — a ViewCube overlay (click a face / drag to orbit) plus the
  keyboard shortcuts below. Double-click an element to select and frame it
  (configurable in Settings).
- **Language** — the whole UI switches between **Romanian (default)** and
  **English** at runtime via the top-right RO/EN button; the preference is saved to
  `localStorage`. IFC technical terms (class names, `Pset_*`/`Qto_*`, `GlobalId`,
  schema, `Stereo 70`) stay verbatim in both languages.

### Keyboard shortcuts (3D viewer)

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `1`–`6` | Top / bottom / front / back / left / right view | `0` | Isometric view |
| `Z` | Fit all | `C` | Frame the selection |
| `+` / `-` | Zoom in / out | `H` | Hide / restore the selection |
| `L` | Isolate the selection | `A` | Show all |
| `S` | Toggle the section plane | `O` | Toggle perspective / orthographic |
| `E` | Toggle the attribute/property editor | `M` | Measure tool (distance) |
| `T` | Toggle the data table | `B` | Toggle the BCF panel |
| `I` | Toggle the IDS panel | `F` | Open the Filter |
| `X` | Toggle the Clashes panel | `/` | Focus the tree search |
| `?` | Open the help / guide | `Esc` | Cancel the active command |
| `Delete` / `Backspace` | Delete the active measurement | | |

> Shortcuts are ignored while typing in an input field.

## Prerequisites

- **Node.js** (LTS; CI builds on Node 20) and **npm**.
- A **WebGPU-capable browser** for the 3D viewer — recent Chrome/Edge, or Safari 18+.
  (Editing, export, and the globe work without WebGPU.)
- **No** Rust toolchain or `wasm-pack` — the `@ifc-lite` WASM core ships prebuilt via npm.

## Getting started

```bash
npm install      # installs deps, including the prebuilt @ifc-lite WASM core
npm run dev      # Vite dev server (default http://localhost:5173)
npm run build    # type-check (tsc --noEmit) + production build to dist/
npm run preview  # serve the built dist/ locally (default http://localhost:4173)
```

## Testing

```bash
npm test         # vitest run
```

The suite lives in `tests/`:

- **`geo.test.ts`** — crs (Stereo 70 ↔ WGS84), geoid undulation, and placement-mode
  unit tests. Pure math; always runs.
- **`idsWriter.test.ts`** — the IDS serializer: round-trips an authored `IDSDocument`
  (every facet + constraint) through `serializeIds` → `parseIdsXml` and audits the XML.
  Always runs.
- **`boqReport.test.ts`** — the bill-of-quantities preset builder (`boqPresetConfig`):
  groups by class → material and picks the present base quantities. Pure; always runs.
- **`pivot.test.ts`** — the data-table aggregation engine (`buildPivot`): the five
  aggregators (sum / avg / count / min / max), `NO_VALUE` / missing-field handling
  (elements without a field don't corrupt sums or averages), the `distinctFieldValues`
  cap, and `exportPivotCsv` (RFC-4180 quoting + UTF-8 BOM). Pure; always runs.
- **`analytics.test.ts`** — the analytics helpers (`chartData`, `kpiValue`,
  `filteredModels`, `combineFilter`): per-class aggregation with global ids, KPI counts,
  cross-filter subsetting, and OR-within / AND-across-dimension filter combining.
  Pure; always runs.
- **`clash.test.ts`** — clash detection: AABB hard/clearance classification, pair dedup +
  self-exclusion, the triangle-triangle intersection test (crossing / separated / coplanar),
  narrow-phase false-positive rejection, status persistence and the async/cancel path. Pure;
  always runs.
- **`createSite.test.ts`** — `IfcEditor` round-trip on an inline minimal IFC4 model
  (edit attribute + property + new pset, then export and re-open). Self-contained;
  always runs.
- **`editor.test.ts`** — the same round-trip against a real IFC file. It is guarded by
  `describe.runIf(...)` and **skips** unless a sample is available; point it at one with
  `IFC_SAMPLE=<path>` (default is a local path that won't exist on most machines).
- **`i18n.test.ts`** — RO/EN dictionary parity: asserts `ro.ts` and `en.ts` expose exactly
  the same leaf keys in both directions and that every leaf is a non-empty string.
  Pure; always runs.

## Configuration

All build config is in [`vite.config.ts`](vite.config.ts) (each option is commented):

- `base: "./"` — relative asset URLs, so the build works at any GitHub Pages path.
- `build.target: "esnext"` (and the matching `optimizeDeps.esbuildOptions.target`) —
  `@ifc-lite/ids` uses top-level `await`, which needs a modern target.
- `worker.format: "es"` — `@ifc-lite` workers are loaded as ES modules.
- `optimizeDeps.exclude: [@ifc-lite/parser, geometry, renderer, wasm]` — keeps Vite
  from pre-bundling these so their `new URL(..., import.meta.url)` worker/WASM asset
  references resolve correctly.
- `vite-plugin-cesium` copies Cesium's static assets and sets `window.CESIUM_BASE_URL`
  for the globe view.

## Project structure

```
index.html                  app entry (loads src/main.tsx)
vite.config.ts              Vite config (base, esnext target, Cesium, @ifc-lite workers)
tsconfig.json              TS config (strict; includes src, tests, vite.config.ts)
public/
  bs_Logo.png              favicon
  logo_bsro.svg            buildingSMART România logo (theme-aware)
  geoid/egm2008-ro.json    EGM2008 geoid undulation grid, clipped to Romania
  samples/*.ifc            bundled demo models (building + infrastructure), loadable from the start screen
scripts/gen-geoid.mjs      one-off generator for the geoid grid asset (not in the build)
src/
  main.tsx                 React entry
  App.tsx                  app shell: top bar, 3D / Globe tabs, primary editor state
  ifc/
    store.ts               shared @ifc-lite columnar parse provider (parseStore)
    editor.ts              IfcEditor: read / edit / export (+ BulkQueryEngine.select for Filter)
    constants.ts           counties, pset/property names, Stereo 70 defaults
    bcf.ts                 BCF read/write helpers
    ids.ts                 IDS validate + serialize (parse/validate/audit + serializeIds)
    idsWriter.ts           serialize an IDSDocument to buildingSMART IDS 1.0 XML
    idsCatalog.ts          authoring catalogs (IFC classes, psets, data types, from-model)
  components/
    Header, UploadPanel, Viewer, IfcTree, PropsPanel, EditPanel, GlobeViewer,
    ModelsPanel, NavCube, ViewBar, BcfPanel, IdsPanel, DataTablePanel,
    DataTableConfig, Modal, HelpModal, SettingsModal, ErrorBoundary,
    IdsEditorModal (IDS creator), FilterPanel (filter & select),
    AnalyticsPanel (charts dashboard — experimental), ClashPanel (clash detection)
  viewer/
    engine.ts              WebGPU engine wrapper (@ifc-lite/renderer): federated load,
                           pick/render, camera + nav-cube matrices, selection outline,
                           section indicator, snapping, projection
    model.ts               per-model spatial/class/material trees + property groups
    pivot.ts               data-table model: field discovery, aggregation, CSV export
    analytics.ts           analytics chart data + cross-filter logic (reuses pivot)
    clash.ts               clash detection: AABB broad phase + triangle-triangle narrow phase (pure)
    boqReport.ts           bill-of-quantities preset + printable (PDF) HTML report
    measure.ts             measurement tool (length/point/area) + snap glyphs
    overlayColors.ts       theme-aware colors for the SVG overlays
  geo/
    crs.ts                 Stereo 70 ↔ WGS84 (proj4)
    geoid.ts               EGM2008 geoid grid lookup
    extractGeometry.ts     pull mesh data for globe placement
    placement.ts           Stereo 70 → WGS84 + cotă; placement-mode detection
    glb.ts                 GLB builder for Cesium
  settings/                app settings: singleton + React provider/hook + unit format
  i18n/                    RO/EN translations: framework-agnostic singleton +
                           typed dictionaries (ro.ts/en.ts) + React provider/hook
  hooks/
    useTheme.ts            light/dark theme
    usePersistedNumber.ts  localStorage-backed number state (panel sizes)
    useDockResize.ts       shared drag-to-resize hook for the bottom docks
  theme/theme.css          buildingSMART palette + light/dark
tests/                     vitest suite (see Testing)
```

## Deployment (GitHub Pages)

Because `vite.config.ts` sets `base: "./"`, the build works at any Pages path without
changes. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs `npm ci`,
`npm test` (the suite gates the deploy), then `npm run build` and publishes `dist/` on
every push to `main` (enable **Settings → Pages → Source: GitHub Actions**). Cesium's assets and the `@ifc-lite` WASM + geometry
workers are bundled by Vite at build time; the 3D viewer still needs a WebGPU-capable
browser at runtime, but editing/export and the globe do not.

Live at **https://buildingsmart-romania.github.io/ifcescu-app/**.

## Notes

- **Engine:** parsing, geometry, editing and export run on `@ifc-lite`; rendering runs
  on `@ifc-lite/renderer` (WebGPU). IFC2X3 / IFC4 / IFC4X3 are parsed natively.
- **WebGPU is required for the 3D viewer** — there is no WebGL fallback in the renderer.
- **Export is non-destructive** — `@ifc-lite/export` regenerates STEP while preserving
  every untouched record with full numeric precision (Stereo 70 eastings/northings keep
  all significant digits); only the entities you edited change.
- **Section** clips against a single plane at a time; creating a new one replaces it.
- **Snapping** is computed app-side from retained geometry, so the snap methods are
  fully selectable and the glyphs are precise.
- The **Cesium globe is token-free** (no Cesium ion token). Horizontal Stereo 70 → WGS84
  uses a 7-parameter Helmert (≈ sub-2 m) — fine for context, not a cadastral-grade grid.
- Large IFC files are parsed client-side, so they take longer to open; very large
  georeferenced models use `@ifc-lite`'s RTC origin to avoid float32 jitter.
- The location card and map/Earth links need network access (they stay empty offline).

## License

This project's own source code is released under the **Mozilla Public License 2.0
(MPL-2.0)** — © 2026 buildingSMART Romania. See [`LICENSE`](LICENSE); all source files in
this repository are covered.

It builds on [**`@ifc-lite`**](https://github.com/LTplus-AG/ifc-lite) (© LTplus-AG), which
is also **MPL-2.0**. The production build bundles those files; their source is available
upstream and their license notices are preserved. MPL-2.0 is a *file-level* copyleft: it
permits commercial use and combining with other code, and only requires that MPL-covered
files themselves stay open.
