import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/react";
import { TOUR_STEPS, type TourStep } from "./tourSteps";

interface Props {
  /** Called when the tour ends (finished or dismissed). */
  onClose: () => void;
}

/** Padding around the highlighted element, px. */
const PAD = 6;
/** Fixed card width (must match .tour-card in theme.css), px. */
const CARD_W = 320;
/** Rough card height used only to pick above/below placement, px. */
const CARD_H = 190;

function targetEl(step: TourStep): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

function isVisible(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Guided spotlight tour over the live UI. Highlights one [data-tour] element at
 *  a time with a dimmed backdrop and an explaining card. Steps whose target is
 *  absent/hidden (gated module, setting off) are skipped. ←/→ navigate, Esc and
 *  the backdrop-click-on-last-step end the tour. */
export function TourOverlay({ onClose }: Props) {
  const { t } = useI18n();
  // Resolve the steps once at start — the tour targets chrome that doesn't
  // appear/disappear while the overlay is up (interactions are blocked).
  const steps = useMemo(() => TOUR_STEPS.filter((s) => isVisible(targetEl(s))), []);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = steps[idx];
  const next = () => (idx < steps.length - 1 ? setIdx(idx + 1) : onClose());
  const back = () => idx > 0 && setIdx(idx - 1);

  // Nothing to show (e.g. tour started before the viewer rendered) — bail out.
  useEffect(() => {
    if (!steps.length) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length]);

  // Track the current target's rectangle; follow layout changes.
  useEffect(() => {
    if (!step) return;
    const el = targetEl(step);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    let raf = 0;
    const measure = () => setRect(el.getBoundingClientRect());
    const onLayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [step]);

  // Keyboard: arrows navigate, Escape ends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!step || !rect) return null;

  const spot = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // Card below the target when there's room, otherwise above; clamped to the
  // viewport horizontally.
  const below = spot.top + spot.height + CARD_H + 12 < window.innerHeight;
  const cardTop = below ? spot.top + spot.height + 10 : Math.max(10, spot.top - CARD_H - 10);
  const cardLeft = Math.min(Math.max(10, spot.left), Math.max(10, window.innerWidth - CARD_W - 10));

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label={t(step.titleKey)}>
      {/* Click-catcher: blocks the app while touring; a click advances. */}
      <div className="tour-backdrop" onClick={next} />
      <div className="tour-spot" style={spot} />
      <div className="tour-card" style={{ top: cardTop, left: cardLeft, width: CARD_W }}>
        <div className="tour-card-head">
          <span className="tour-count">{t("tour.stepCount", { n: idx + 1, total: steps.length })}</span>
          <button className="modal-close" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>×</button>
        </div>
        <div className="tour-card-title">{t(step.titleKey)}</div>
        <div className="tour-card-body">{t(step.bodyKey)}</div>
        <div className="tour-card-actions">
          <button className="btn secondary" onClick={back} disabled={idx === 0}>{t("tour.back")}</button>
          <button className="btn" onClick={next} autoFocus>
            {idx < steps.length - 1 ? t("tour.next") : t("tour.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
