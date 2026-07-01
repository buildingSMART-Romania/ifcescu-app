import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import { useI18n } from "../i18n/react";
import type { I18nKey } from "../i18n";

type Preset = "top" | "bottom" | "front" | "back" | "left" | "right";

interface FaceDef { key: string; labelKey: I18nKey; preset: Preset; placement: string; labelRot?: number }

const SIZE = 62;
const H = SIZE / 2;

// Standard CSS cube placement (lines up with engine.cubeMatrix at the front view).
// `labelRot` rotates a face's text in-plane so it reads upright at that view
// (the bottom face would otherwise show upside-down when seen from below).
const FACES: FaceDef[] = [
  { key: "front", labelKey: "viewer.viewFront", preset: "front", placement: `translateZ(${H}px)` },
  { key: "back", labelKey: "viewer.viewBack", preset: "back", placement: `rotateY(180deg) translateZ(${H}px)` },
  { key: "right", labelKey: "viewer.viewRight", preset: "right", placement: `rotateY(90deg) translateZ(${H}px)` },
  { key: "left", labelKey: "viewer.viewLeft", preset: "left", placement: `rotateY(-90deg) translateZ(${H}px)` },
  { key: "top", labelKey: "viewer.viewTop", preset: "top", placement: `rotateX(90deg) translateZ(${H}px)` },
  { key: "bottom", labelKey: "viewer.viewBottom", preset: "bottom", placement: `rotateX(-90deg) translateZ(${H}px)`, labelRot: 180 },
];

interface Props {
  /** Current CSS matrix3d for the cube (camera orientation). */
  getTransform: () => string;
  onFace: (v: Preset) => void;
  /** Drag the cube to orbit the camera (raw pixel deltas). */
  onOrbit: (dx: number, dy: number) => void;
}

/** Navigation cube: rotates with the camera; click a face → that view; drag it
 *  to orbit (the camera and the cube rotate together). */
export function NavCube({ getTransform, onFace, onOrbit }: Props) {
  const { t } = useI18n();
  const cubeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (cubeRef.current) cubeRef.current.style.transform = getTransform();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTransform]);

  // Drag vs click: a gesture that moves past a few px orbits and suppresses the
  // click; a still click snaps to the face view.
  const down = useRef(false);
  const moved = useRef(false);
  const lx = useRef(0);
  const ly = useRef(0);

  const onDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    down.current = true;
    moved.current = false;
    lx.current = e.clientX;
    ly.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!down.current) return;
    const dx = e.clientX - lx.current;
    const dy = e.clientY - ly.current;
    if (!moved.current && Math.abs(dx) + Math.abs(dy) <= 3) return;
    moved.current = true;
    onOrbit(dx, dy);
    lx.current = e.clientX;
    ly.current = e.clientY;
  };
  const onUp = (e: ReactPointerEvent) => {
    down.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onClick = (e: ReactMouseEvent, preset: Preset) => {
    e.stopPropagation();
    if (moved.current) return; // was a drag, not a click
    onFace(preset);
  };

  return (
    <div className="navcube-wrap" title={t("navcube.title")}>
      <div className="navcube" ref={cubeRef}>
        {FACES.map((face) => (
          <div
            key={face.key}
            className="navcube-face"
            style={{ width: SIZE, height: SIZE, transform: face.placement }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onClick={(e) => onClick(e, face.preset)}
          >
            <span className="navcube-label" style={face.labelRot ? { transform: `rotate(${face.labelRot}deg)` } : undefined}>{t(face.labelKey)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
