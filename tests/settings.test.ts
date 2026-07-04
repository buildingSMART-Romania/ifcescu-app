import { describe, it, expect, beforeEach } from "vitest";

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

  it("nav defaults are sane (manual pivot, 100% speeds, dbl-click on)", async () => {
    const { DEFAULTS } = await import("../src/settings/index");
    expect(DEFAULTS.viewer.nav).toEqual({
      pivotMode: "manual",
      zoomSpeed: 1,
      orbitSpeed: 1,
      panSpeed: 1,
      dblClickFrame: true,
    });
  });
});
