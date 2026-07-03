import { useCallback, useEffect, useRef } from "react";
import { usePersistedNumber } from "./usePersistedNumber";

interface DockResizeOptions {
  /** Smallest allowed dock height (px). */
  min?: number;
  /** Space kept free above the dock: max height = window.innerHeight - reserve. */
  reserve?: number;
  /** Derive the height from the pointer's window position (innerHeight - clientY
   *  - offset) instead of the drag delta — the table dock's behavior. */
  absolute?: boolean;
  /** Gap between the pointer and the dock top in absolute mode (px). */
  offset?: number;
}

/**
 * Persisted, drag-resizable height for a bottom dock. Wraps usePersistedNumber
 * plus the pointerdown → window pointermove/pointerup drag the Analytics /
 * Clash / Filter / Table docks each duplicated. Pointer events (not mouse) so
 * touch/pen can resize too. The window listeners are removed on pointerup AND
 * on unmount, so closing a panel mid-drag no longer leaks listeners or calls
 * setState on an unmounted component.
 */
export function useDockResize(
  key: string,
  initial: number,
  opts: DockResizeOptions = {},
): { height: number; startResize: (e: { clientY: number; preventDefault: () => void }) => void } {
  const { min = 160, reserve = 140, absolute = false, offset = 16 } = opts;
  const [height, setHeight] = usePersistedNumber(key, initial);
  const heightRef = useRef(height);
  heightRef.current = height;
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const startResize = useCallback(
    (e: { clientY: number; preventDefault: () => void }) => {
      e.preventDefault();
      stopRef.current?.(); // never stack two drags
      const sy = e.clientY, h0 = heightRef.current;
      const move = (ev: PointerEvent) => {
        const raw = absolute ? window.innerHeight - ev.clientY - offset : h0 + (sy - ev.clientY);
        setHeight(Math.max(min, Math.min(window.innerHeight - reserve, raw)));
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        stopRef.current = null;
      };
      stopRef.current = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
    [absolute, offset, min, reserve, setHeight],
  );

  return { height, startResize };
}
