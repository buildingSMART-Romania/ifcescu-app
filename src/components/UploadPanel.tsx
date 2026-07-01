import { useRef, useState } from "react";
import { useI18n } from "../i18n/react";
// Inlined so the "building" letters (fill:currentColor) follow the theme color.
import logoRaw from "../../public/logo_bsro.svg?raw";

interface Props {
  onFile: (file: File) => void;
  variant?: "drop" | "button";
}

// Bundled sample models (public/samples/) for users without an IFC at hand.
const SAMPLES: { file: string; labelKey: "upload.sampleBuilding" | "upload.sampleInfra" }[] = [
  { file: "Building-Architecture.ifc", labelKey: "upload.sampleBuilding" },
  { file: "Infra-Road.ifc", labelKey: "upload.sampleInfra" },
];

export function UploadPanel({ onFile, variant = "drop" }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState(false);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  // Fetch a bundled sample and feed it through the normal onFile flow.
  const loadSample = async (file: string) => {
    setLoadingSample(true);
    setSampleError(false);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      onFile(new File([buf], file, { type: "application/x-step" }));
    } catch {
      setSampleError(true);
    } finally {
      setLoadingSample(false);
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".ifc"
      data-testid="ifc-input"
      style={{ display: "none" }}
      onChange={(e) => pick(e.target.files)}
    />
  );

  if (variant === "button") {
    return (
      <>
        <button className="toggle" onClick={() => inputRef.current?.click()} title={t("upload.changeTitle")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: -3 }}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          {t("upload.change")}
        </button>
        {input}
      </>
    );
  }

  return (
    <div className="upload-card">
      <div className="upload-logo" dangerouslySetInnerHTML={{ __html: logoRaw }} />
      <h2>IFCescu</h2>
      <p className="upload-sub">{t("upload.sub")}</p>
      <div
        className="dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files);
        }}
      >
        {t("upload.dropPre")}<strong>.ifc</strong>{t("upload.dropPost")}
      </div>
      <div className="upload-samples">
        <span className="upload-samples-title">{t("upload.sampleTitle")}</span>
        <div className="upload-samples-row">
          {SAMPLES.map((s) => (
            <button key={s.file} className="upload-sample-btn" disabled={loadingSample} onClick={() => loadSample(s.file)}>
              {t(s.labelKey)}
            </button>
          ))}
        </div>
        {sampleError && <span className="upload-sample-err">{t("upload.sampleError")}</span>}
      </div>
      <div className="upload-credit">
        <span>
          {t("upload.creditBuilt")}{" "}
          <a href="https://github.com/LTplus-AG/ifc-lite" target="_blank" rel="noreferrer">ifc-lite</a>.
        </span>
        <span>
          {t("upload.creditThanks")}{" "}
          <a href="https://buymeacoffee.com/louistrue" target="_blank" rel="noreferrer">{t("upload.creditSupport")}</a>.
        </span>
      </div>
      {input}
    </div>
  );
}
