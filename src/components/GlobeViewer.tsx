import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { GeorefInfo } from "../ifc/editor";
import type { Theme } from "../hooks/useTheme";
import { extractMergedMeshFromBytes } from "../geo/extractGeometry";
import { loadGeoidGrid } from "../geo/geoid";
import { computePlacement, toEnuVertices, type Placement } from "../geo/placement";
import { buildGlb } from "../geo/glb";
import { useI18n } from "../i18n/react";

// No Cesium ion: token-free imagery (OpenStreetMap streets / Esri satellite) +
// Esri World Elevation terrain.
Cesium.Ion.defaultAccessToken = "";

const SAT_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

interface Props {
  bytes: Uint8Array;
  georef: GeorefInfo | null;
  theme: Theme;
}

type Status = "loading" | "ready" | "unplaceable" | "error";

export function GlobeViewer({ bytes, georef }: Props) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const satLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [satellite, setSatellite] = useState(false);
  const [earthAlpha, setEarthAlpha] = useState(1);
  const [info, setInfo] = useState<
    (Placement & { vertices: number; triangles: number; terrainHeight?: number }) | null
  >(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    const viewer = new Cesium.Viewer(host, {
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          credit: "© OpenStreetMap contributors",
          maximumLevel: 19,
        }),
      ),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    // Real global terrain, token-free (Esri World Elevation 3D, ellipsoidal
    // heights — matches our absolute ellipsoidal model placement). Falls back to
    // the smooth ellipsoid if it can't be reached.
    try {
      const terrain = new Cesium.Terrain(
        Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
          "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
        ),
      );
      terrain.errorEvent.addEventListener(() => {
        viewer.scene.setTerrain(new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider())));
      });
      viewer.scene.setTerrain(terrain);
    } catch {
      /* keep the default ellipsoid terrain */
    }
    // Let terrain occlude geometry that sits below the ground surface.
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewerRef.current = viewer;
    (window as any).__cesium = viewer;

    // Esri satellite imagery on top of OSM, toggled via the controls panel.
    const satLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({ url: SAT_URL, credit: "Esri World Imagery", maximumLevel: 19 }),
    );
    satLayer.show = false;
    satLayerRef.current = satLayer;

    // Match the Vizualizare 3D controls: left = orbit, right = pan, scroll/middle
    // = zoom (Cesium's defaults are spin/zoom/tilt, which feel different).
    const cc = viewer.scene.screenSpaceCameraController;
    const T = Cesium.CameraEventType;
    cc.tiltEventTypes = [T.LEFT_DRAG]; // orbit around the point under the cursor
    cc.rotateEventTypes = [T.RIGHT_DRAG]; // pan (grab-and-move the surface)
    cc.zoomEventTypes = [T.WHEEL, T.MIDDLE_DRAG, T.PINCH];
    cc.lookEventTypes = [];

    // Camera headlight so the model is always lit regardless of sun position.
    const headlight = new Cesium.DirectionalLight({ direction: viewer.scene.camera.directionWC });
    viewer.scene.light = headlight;
    const onPreRender = () => {
      headlight.direction = Cesium.Cartesian3.clone(viewer.scene.camera.directionWC, headlight.direction);
    };
    viewer.scene.preRender.addEventListener(onPreRender);

    (async () => {
      try {
        const [mesh, grid] = await Promise.all([extractMergedMeshFromBytes(bytes), loadGeoidGrid()]);
        if (disposed) return;
        if (!mesh.vertexCount) {
          setStatus("error");
          setErrMsg(t("globe.noGeometry"));
          return;
        }

        const placement = computePlacement(georef, mesh.bbox, grid);
        setInfo({ ...placement, vertices: mesh.vertexCount, triangles: mesh.triangleCount });

        if (placement.mode === "none") {
          setStatus("unplaceable");
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(25, 46, 1_500_000),
            duration: 0,
          });
          return;
        }

        const enu = toEnuVertices(mesh.positions, georef, placement);
        // Place at the orthometric cotă (Marea Neagră 1975). Global terrain
        // providers (Esri/Cesium) serve mean-sea-level heights that Cesium treats
        // as ellipsoidal, so the cotă world is what keeps the model coherent with
        // the terrain. (The geoid undulation is reported as info only.)
        const anchor = Cesium.Cartesian3.fromDegrees(placement.lonDeg, placement.latDeg, placement.anchorStereo70.h);
        const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);

        // Bounding sphere from the local ENU extents (guaranteed defined).
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let i = 0; i < enu.length; i += 3) {
          if (enu[i] < mnx) mnx = enu[i]; if (enu[i] > mxx) mxx = enu[i];
          if (enu[i + 1] < mny) mny = enu[i + 1]; if (enu[i + 1] > mxy) mxy = enu[i + 1];
          if (enu[i + 2] < mnz) mnz = enu[i + 2]; if (enu[i + 2] > mxz) mxz = enu[i + 2];
        }
        const localBs = new Cesium.BoundingSphere(
          new Cesium.Cartesian3((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2),
          0.5 * Math.hypot(mxx - mnx, mxy - mny, mxz - mnz),
        );

        // Build an in-memory GLB and load it as a Cesium.Model. Local axes are
        // (East, North, Up) so we declare Axis.Z up to skip glTF Y-up correction.
        const glb = buildGlb(
          enu,
          mesh.normals,
          mesh.colors,
          mesh.indices,
          [mnx, mny, mnz],
          [mxx, mxy, mxz],
        );
        const glbUrl = URL.createObjectURL(new Blob([glb as unknown as BlobPart], { type: "model/gltf-binary" }));
        let model: Cesium.Model;
        try {
          model = await Cesium.Model.fromGltfAsync({
            url: glbUrl,
            modelMatrix,
            upAxis: Cesium.Axis.Z,
            forwardAxis: Cesium.Axis.X,
            incrementallyLoadTextures: false,
          });
        } finally {
          URL.revokeObjectURL(glbUrl);
        }
        if (disposed) return;
        viewer.scene.primitives.add(model);

        const worldBs = Cesium.BoundingSphere.transform(localBs, modelMatrix, new Cesium.BoundingSphere());
        viewer.camera.flyToBoundingSphere(worldBs, {
          duration: 1.5,
          offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), worldBs.radius * 3),
        });
        setStatus("ready");

        // Sample the ground height under the anchor (informational; lets the
        // user confirm the model sits coherently on the terrain).
        try {
          const [s] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
            Cesium.Cartographic.fromDegrees(placement.lonDeg, placement.latDeg),
          ]);
          if (!disposed && s && Number.isFinite(s.height)) {
            setInfo((prev) => (prev ? { ...prev, terrainHeight: s.height } : prev));
          }
        } catch {
          /* terrain may be unavailable; readout simply omits the row */
        }
      } catch (e: any) {
        if (disposed) return;
        setStatus("error");
        setErrMsg(e?.message ?? String(e));
      }
    })();

    return () => {
      disposed = true;
      try {
        viewer.scene.preRender.removeEventListener(onPreRender);
        if (!viewer.isDestroyed()) viewer.destroy();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
      satLayerRef.current = null;
    };
  }, [bytes, georef]);

  // Toggle satellite imagery.
  useEffect(() => {
    if (satLayerRef.current) satLayerRef.current.show = satellite;
    viewerRef.current?.scene.requestRender();
  }, [satellite]);

  // Earth transparency: translucent globe reveals geometry below the surface
  // (e.g. foundation piles) and the model through hills.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const tr = v.scene.globe.translucency;
    tr.enabled = earthAlpha < 1;
    tr.frontFaceAlpha = earthAlpha;
    tr.backFaceAlpha = earthAlpha;
    v.scene.requestRender();
  }, [earthAlpha]);

  return (
    <div className="globe-wrap">
      <div className="globe-host" ref={hostRef} />
      <div className="globe-overlay">
        {status === "loading" && <div className="globe-card">{t("globe.placing")}</div>}
        {status === "error" && <div className="globe-card error">{t("globe.errorPrefix")}{errMsg}</div>}
        {status === "unplaceable" && (
          <div className="globe-card warn">{t("globe.unplaceable")}</div>
        )}
        {info && status === "ready" && <Readout info={info} />}

        <div className="globe-card controls">
          <div className="seg">
            <button className={!satellite ? "active" : ""} onClick={() => setSatellite(false)}>{t("globe.street")}</button>
            <button className={satellite ? "active" : ""} onClick={() => setSatellite(true)}>{t("globe.satellite")}</button>
          </div>
          <label className="alpha">
            <span>{t("globe.earthTransparency")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(earthAlpha * 100)}
              onChange={(e) => setEarthAlpha(Number(e.target.value) / 100)}
            />
            <span className="alpha-val">{Math.round((1 - earthAlpha) * 100)}%</span>
          </label>
          <div className="hint">{t("globe.controls")}</div>
        </div>
      </div>
    </div>
  );
}

function Readout({
  info,
}: {
  info: Placement & { vertices: number; triangles: number; terrainHeight?: number };
}) {
  const { t, lang } = useI18n();
  const f = (n: number | undefined, d = 2) =>
    n != null && Number.isFinite(n) ? n.toFixed(d) : "—";
  return (
    <div className="globe-card readout">
      <div className="readout-title">
        {info.mode === "georef" ? t("globe.modeGeoref") : t("globe.modeReal")}
      </div>
      <table>
        <tbody>
          <tr><td>{t("globe.east")}</td><td>{f(info.anchorStereo70.e)} m</td></tr>
          <tr><td>{t("globe.north")}</td><td>{f(info.anchorStereo70.n)} m</td></tr>
          <tr><td>{t("globe.modelElev")}</td><td>{f(info.anchorStereo70.h)} m</td></tr>
          {info.terrainHeight != null && (
            <tr><td>{t("globe.terrainElev")}</td><td>{f(info.terrainHeight)} m</td></tr>
          )}
          <tr><td>{t("globe.lonLat")}</td><td>{f(info.lonDeg, 6)}° / {f(info.latDeg, 6)}°</td></tr>
          <tr><td>{t("globe.geoid")}</td><td>{f(info.geoidUndulation)} m</td></tr>
          <tr><td>{t("globe.ellipsoidal")}</td><td>{f(info.ellipsoidalH)} m</td></tr>
          <tr><td>{t("globe.convergence")}</td><td>{f(info.convergenceDeg, 4)}°</td></tr>
          <tr><td>{t("globe.triangles")}</td><td>{info.triangles.toLocaleString(lang === "en" ? "en-US" : "ro-RO")}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
