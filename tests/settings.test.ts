import { describe, it, expect, beforeEach, vi } from "vitest";

// settings/index.ts reads localStorage at module load — shim it before importing.
function installStorage(seed?: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  (globalThis as any).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
  return m;
}

beforeEach(() => {
  installStorage();
});

// merge() is hand-written per key group — exactly the place where a newly added
// nested group (like viewer.nav) silently disappears for users with an older
// persisted blob. These tests guard that seam.
describe("settings merge of older persisted blobs", () => {
  it("an old blob without viewer.nav gains the full nav defaults", async () => {
    const { DEFAULTS } = await import("../src/settings/index");
    const { updateSettings, getSettings } = await import("../src/settings/index");
    // Simulate an old blob by applying a patch that predates nav entirely.
    updateSettings({ viewer: { navCube: false } });
    const s = getSettings();
    expect(s.viewer.navCube).toBe(false);
    expect(s.viewer.nav).toEqual(DEFAULTS.viewer.nav);
  });

  it("a blob with a custom nav value keeps it and fills the rest", async () => {
    const { DEFAULTS, updateSettings, getSettings } = await import("../src/settings/index");
    updateSettings({ viewer: { nav: { zoomSpeed: 2 } } });
    const s = getSettings();
    expect(s.viewer.nav.zoomSpeed).toBe(2);
    expect(s.viewer.nav.pivotMode).toBe(DEFAULTS.viewer.nav.pivotMode);
    expect(s.viewer.nav.dblClickFrame).toBe(DEFAULTS.viewer.nav.dblClickFrame);
    // Sibling groups untouched by the patch keep their defaults.
    expect(s.viewer.snap).toEqual(DEFAULTS.viewer.snap);
  });

  it("nav defaults are sane (orbit around selection, 100% speeds, dbl-click on)", async () => {
    const { DEFAULTS } = await import("../src/settings/index");
    expect(DEFAULTS.viewer.nav).toEqual({
      pivotMode: "selection",
      zoomSpeed: 1,
      orbitSpeed: 1,
      panSpeed: 1,
      dblClickFrame: true,
    });
  });
});

// load() runs at module import, so each case seeds storage and re-imports.
describe("pivot-mode migration of stored blobs", () => {
  const KEY = "ifc-app-settings";
  async function loadWith(blob: unknown) {
    installStorage({ [KEY]: JSON.stringify(blob) });
    vi.resetModules();
    return (await import("../src/settings/index")).getSettings();
  }

  it("a pre-v2 blob holding the old default 'manual' picks up orbit-around-selection", async () => {
    const s = await loadWith({ viewer: { navCube: false, nav: { pivotMode: "manual", zoomSpeed: 2 } } });
    expect(s.viewer.nav.pivotMode).toBe("selection");
    expect(s.viewer.nav.zoomSpeed).toBe(2); // the rest of the blob is kept
    expect(s.viewer.navCube).toBe(false);
  });

  it("an explicit 'manual' saved as v2 is respected", async () => {
    expect((await loadWith({ v: 2, viewer: { nav: { pivotMode: "manual" } } })).viewer.nav.pivotMode).toBe("manual");
  });

  it("a pre-v2 non-default choice (autoFrame) is kept", async () => {
    expect((await loadWith({ viewer: { nav: { pivotMode: "autoFrame" } } })).viewer.nav.pivotMode).toBe("autoFrame");
  });

  it("saving writes the v2 marker", async () => {
    const m = installStorage();
    vi.resetModules();
    const { updateSettings } = await import("../src/settings/index");
    updateSettings({ viewer: { nav: { pivotMode: "manual" } } });
    expect(JSON.parse(m.get(KEY)!).v).toBe(2);
  });
});
