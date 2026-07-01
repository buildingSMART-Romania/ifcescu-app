import { type ReactNode, useEffect } from "react";
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
 *  × button, and on backdrop click (clicks inside the card are stopped). */
export function Modal({ title, onClose, children, footer, className }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={"modal" + (className ? " " + className : "")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="modal-close" onClick={onClose} title={t("common.close")}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
