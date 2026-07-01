// Inlined so the "building" letters (fill:currentColor) follow the theme color.
import logoRaw from "../../public/logo_bsro.svg?raw";

/** App brand block (logo + name) shown at the left of the top bar. */
export function Header() {
  return (
    <div className="brand">
      <a
        className="brand-logo"
        href="https://buildingsmartromania.org/"
        target="_blank"
        rel="noreferrer"
        title="buildingSMART România"
        dangerouslySetInnerHTML={{ __html: logoRaw }}
      />
      <span className="brand-name">IFCescu</span>
    </div>
  );
}
