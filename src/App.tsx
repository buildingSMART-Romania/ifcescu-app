import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "./hooks/useTheme";
import { useI18n } from "./i18n/react";
import { IfcEditor } from "./ifc/editor";
import type { GeorefInfo } from "./ifc/editor";
import type { PlacementMode } from "./geo/placement";
import { Header } from "./components/Header";
import { UploadPanel } from "./components/UploadPanel";
import { Viewer } from "./components/Viewer";
import { HelpModal } from "./components/HelpModal";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TourOverlay } from "./components/tour/TourOverlay";
import type { IDSValidationReport } from "./ifc/ids";
import type { BCFProject } from "./ifc/bcf";

// Cesium is ~3 MB+ — code-split it so the initial load doesn't pay for the globe
// until the user actually opens the Glob 3D tab.
const GlobeViewer = lazy(() =>
  import("./components/GlobeViewer").then((m) => ({ default: m.GlobeViewer })),
);

interface Loaded {
  editor: IfcEditor;
  georef: GeorefInfo | null;
  bytes: Uint8Array;
  fileName: string;
}

/** A federated (non-primary) model added in the 3D viewer. */
interface ExtraModel {
  id: string;
  bytes: Uint8Array;
  fileName: string;
}

/** Small line icons for the top-bar tabs. */
function TabIcon({ kind }: { kind: "view" | "globe" }) {
  const a = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "view") return <svg {...a}><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 12l9-5M12 12v10M12 12L3 7" /></svg>;
  return <svg {...a}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const { lang, setLang, t } = useI18n();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The model's embedded georef (IfcMapConversion), read at load. The globe tab
  // re-places the model from it.
  const [georef, setGeoref] = useState<GeorefInfo | null>(null);
  // Whether the primary model can be placed on the globe. null = not yet known
  // (Viewer reports it after load). "none" disables the Glob 3D tab.
  const [globeMode, setGlobeMode] = useState<PlacementMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"view" | "globe">("view");
  // Once the globe tab has been opened, keep GlobeViewer mounted (hidden via CSS)
  // so tab switches don't re-extract/re-place the mesh. Reset per model.
  const [globeOpened, setGlobeOpened] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // The guided tour is launched from the Help modal only.
  const [tourActive, setTourActive] = useState(false);
  // Number of edits made to the primary IFC (drives the top-bar download button).
  const [changeCount, setChangeCount] = useState(0);
  // Favorited property names for the 3D viewer's property panel. Owned here so a
  // new import resets them (they belong to the currently loaded model).
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  // IDS report + BCF project. Owned here (same per-model lifecycle as favorites)
  // so a new import resets them; both surface in the docked panels of the 3D viewer.
  const [idsReport, setIdsReport] = useState<IDSValidationReport | null>(null);
  const [bcfProject, setBcfProject] = useState<BCFProject | null>(null);
  // Federated models added in the 3D viewer (beyond the primary `loaded` one).
  const [extraModels, setExtraModels] = useState<ExtraModel[]>([]);
  const extraSeq = useRef(0);
  // Generation counter for async load paths: bumped by every primary load so a
  // slow, superseded parse can't overwrite the state of a newer one (e.g. drop
  // big file A, then small file B — A must not replace B when it finally resolves).
  const loadSeq = useRef(0);
  const toggleFavorite = (key: string) =>
    setFavorites((s) => {
      const x = new Set(s);
      x.has(key) ? x.delete(key) : x.add(key);
      return x;
    });

  const onFile = async (file: File) => {
    const gen = ++loadSeq.current; // supersedes any in-flight load
    setError(null);
    setBusy(true);
    setLoaded(null);
    setGeoref(null);
    setFavorites(new Set()); // reset favorites for the new model
    setIdsReport(null);
    setBcfProject(null);
    setExtraModels([]); // federated models belonged to the previous session
    setChangeCount(0); // edits belonged to the previous model
    setGlobeMode(null); // placeability is re-determined for the new model
    setGlobeOpened(false); // the kept-alive globe belonged to the previous model
    if (globeOpened) {
      // The globe's mesh cache pins the previous model's merged mesh; drop it.
      // Dynamic import so the geometry chunk isn't loaded eagerly — if the globe
      // was never opened the cache is empty and there's nothing to clear.
      import("./geo/extractGeometry").then((m) => m.clearMeshCache()).catch(() => {});
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The primary model's editor lives here so edits + the download button
      // survive tab switches. The 3D viewer edits this same editor instance.
      const editor = await IfcEditor.open(bytes);
      if (gen !== loadSeq.current) return; // a newer load took over
      const g = editor.getGeoref();
      setLoaded({ editor, georef: g, bytes, fileName: file.name });
      setGeoref(g);
      // globeMode stays null until the Viewer reports it (a georef alone doesn't
      // mean a real location — a zero/degenerate map conversion isn't placeable).
      setTab("view");
    } catch (e: any) {
      if (gen !== loadSeq.current) return; // stale failure — don't paint over the newer load
      setError(t("app.invalidIfc", { detail: e?.message ? `(${e.message})` : "" }));
    } finally {
      if (gen === loadSeq.current) setBusy(false);
    }
  };

  // Federation: add/remove non-primary models (3D viewer only).
  const onAddModel = async (file: File) => {
    const gen = loadSeq.current; // adds belong to the current primary session
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (gen !== loadSeq.current) return; // a new primary load reset the session
      setExtraModels((p) => [...p, { id: `extra-${++extraSeq.current}`, bytes, fileName: file.name }]);
    } catch (e: any) {
      if (gen !== loadSeq.current) return;
      setError(t("app.invalidIfc", { detail: e?.message ? `(${e.message})` : "" }));
    }
  };
  const onRemoveModel = (id: string) => setExtraModels((p) => p.filter((m) => m.id !== id));

  // Download the primary model with its edits applied (non-destructive export).
  const downloadEdited = () => {
    if (!loaded) return;
    let out: unknown;
    try {
      out = loaded.editor.export(); // WASM export can throw — don't fail silently
    } catch (e: any) {
      setError(t("app.invalidIfc", { detail: e?.message ? `(${e.message})` : "" }));
      return;
    }
    const base = loaded.fileName.replace(/\.ifc$/i, "");
    const blob = new Blob([out as BlobPart], { type: "application/x-step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}-${t("app.editedSuffix")}.ifc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // The uniform model list the 3D viewer federates (primary first).
  const viewerModels = useMemo(
    () =>
      loaded
        ? [
            { id: "model-0", bytes: loaded.bytes, fileName: loaded.fileName, georef: loaded.georef, primary: true },
            ...extraModels.map((m) => ({ id: m.id, bytes: m.bytes, fileName: m.fileName, georef: null, primary: false })),
          ]
        : [],
    [loaded, extraModels],
  );

  // Auto-load a bundled sample from a URL query param (e.g.
  // ?model=Building-Architecture.ifc) so a shareable link opens straight into the
  // viewer, skipping the upload screen. Not surfaced anywhere in the UI — it's a
  // link-only entry point. Restricted to a bare .ifc filename under public/samples
  // (no path traversal, no cross-origin fetch).
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get("model");
    if (!name) return;
    const file = name.split(/[\\/]/).pop() || "";
    if (!/^[\w.-]+\.ifc$/i.test(file)) return;
    let cancelled = false;
    const gen = loadSeq.current; // if the user starts a load first, the sample yields
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        if (!cancelled && gen === loadSeq.current) onFile(new File([buf], file, { type: "application/x-step" }));
      } catch (e: any) {
        if (!cancelled && gen === loadSeq.current) setError(t("app.invalidIfc", { detail: e?.message ? `(${e.message})` : "" }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global "?" opens the guide (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      setShowHelp(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The tour anchors on the 3D view's chrome — drop it if the model goes away.
  useEffect(() => {
    if (!loaded) setTourActive(false);
  }, [loaded]);

  const endTour = () => setTourActive(false);
  // From Help: start the tour over the live UI (only offered with a model up).
  const startTourFromHelp = () => {
    setShowHelp(false);
    setTab("view");
    setTourActive(true);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Header />

        {loaded && (
          <nav className="tabs topbar-tabs">
            <button className={"tab" + (tab === "view" ? " active" : "")} onClick={() => setTab("view")}>
              <TabIcon kind="view" /><span>{t("app.tabView")}</span>
            </button>
            <button
              className={"tab" + (tab === "globe" ? " active" : "")}
              data-tour="globeTab"
              onClick={() => { setTab("globe"); setGlobeOpened(true); }}
              disabled={globeMode === "none"}
              title={globeMode === "none" ? t("app.globeDisabledTitle") : t("app.tabGlobe")}
            >
              <TabIcon kind="globe" /><span>{t("app.tabGlobe")}</span>
            </button>
          </nav>
        )}

        <div className="topbar-right">
          {loaded && changeCount > 0 && (
            <button className="dl-btn" onClick={downloadEdited} title={t("app.downloadTitle")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
              <span>{t("app.download")}</span>
              <span className="dl-count">{changeCount}</span>
            </button>
          )}
          {loaded && <UploadPanel onFile={onFile} variant="button" />}
          <button className="help-toggle" data-tour="help" onClick={() => setShowHelp(true)} title={t("help.buttonTitle")} aria-label={t("help.buttonTitle")}>
            ?
          </button>
          <button className="settings-toggle" onClick={() => setShowSettings(true)} title={t("settings.buttonTitle")} aria-label={t("settings.buttonTitle")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
          <button
            className="lang-toggle"
            onClick={() => setLang(lang === "ro" ? "en" : "ro")}
            title={t("app.langToggleTitle")}
            aria-label={t("app.langToggleTitle")}
          >
            {lang === "ro" ? "EN" : "RO"}
          </button>
          <button className="theme-toggle" onClick={toggleTheme} title={theme === "dark" ? t("app.themeLight") : t("app.themeDark")} aria-label={theme === "dark" ? t("app.themeLight") : t("app.themeDark")}>
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>
            )}
          </button>
        </div>
      </header>

      <main className="main">
        {!loaded && (
          <div className="upload-empty">
            <div>
              <UploadPanel onFile={onFile} variant="drop" />
              {busy && (
                <div className="loading-card">
                  <span className="spinner" />
                  <div className="loading-text">
                    <div className="loading-title">{t("app.processing")}</div>
                    <div className="loading-hint">{t("app.processingHint")}</div>
                  </div>
                </div>
              )}
              {error && <div className="alert error" role="alert">{error}</div>}
            </div>
          </div>
        )}

        {/* With a model on screen the empty-state alert above doesn't render, so
            errors (failed export / failed federated add) surface as a toast. */}
        {loaded && error && (
          <div className="alert error app-error-toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} title={t("common.close")} aria-label={t("common.close")}>×</button>
          </div>
        )}

        {loaded && (
          <ErrorBoundary key={loaded.fileName} title={t("app.crashTitle")} body={t("app.crashBody")} reloadLabel={t("app.reload")}>
            {/* Both panes stay mounted; CSS hides the inactive one. Unmounting the
                Viewer would dispose the WebGPU engine and lose selection/hidden
                sets/section/measurements/camera on every tab switch. */}
            <div className={"tab-pane" + (tab === "view" ? "" : " tab-hidden")}>
              <Viewer
                editor={loaded.editor}
                onChangeCount={setChangeCount}
                bytes={loaded.bytes}
                fileName={loaded.fileName}
                theme={theme}
                georef={georef}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                bcfProject={bcfProject}
                onBcfProject={setBcfProject}
                idsReport={idsReport}
                onIdsReport={setIdsReport}
                models={viewerModels}
                onAddModel={onAddModel}
                onRemoveModel={onRemoveModel}
                onPlacementMode={setGlobeMode}
              />
            </div>
            {globeOpened && (
              <div className={"tab-pane" + (tab === "globe" ? "" : " tab-hidden")}>
                <Suspense
                  fallback={
                    <div className="loading-card">
                      <span className="spinner" />
                      <div className="loading-text">
                        <div className="loading-title">{t("common.loading")}</div>
                      </div>
                    </div>
                  }
                >
                  <GlobeViewer bytes={loaded.bytes} georef={georef} theme={theme} />
                </Suspense>
              </div>
            )}
          </ErrorBoundary>
        )}
      </main>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} onStartTour={loaded ? startTourFromHelp : undefined} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {tourActive && loaded && <TourOverlay onClose={endTour} />}
    </div>
  );
}
