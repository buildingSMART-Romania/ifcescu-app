import { type ReactNode, useEffect, useRef } from "react";
import { useI18n } from "../i18n/react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra class on the modal card (e.g. "modal-wide" for the IDS editor). */
  className?: string;
}

/** Lightweight modal: fixed backdrop + centered card. Closes on Escape, on the
 *  × button, and on backdrop click (clicks inside the card are stopped).
 *  Exposes dialog semantics + moves focus into the card and restores it on close. */
export function Modal({ title, onClose, children, footer, className }: Props) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Move focus into the dialog, then restore it to the opener on close.
    const prev = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const first = card?.querySelector<HTMLElement>(
      "input, textarea, select, button:not(.modal-close), [tabindex]:not([tabindex='-1'])",
    );
    (first ?? card)?.focus();
    return () => prev?.focus?.();
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={cardRef}
        className={"modal" + (className ? " " + className : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{title}</span>
          <button className="modal-close" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
