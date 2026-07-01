import { useState } from "react";
import { useI18n } from "../i18n/react";

export interface PropRow {
  k: string;
  v: string;
  /** True when this property/attribute has a pending edit (shows an "editat" badge). */
  edited?: boolean;
}
export interface PropGroup {
  name: string;
  rows: PropRow[];
}

/** General model/file info shown in the right panel when nothing is selected. */
export interface FileInfo {
  fileName: string;
  fileSizeKB: number;
  schema: string;
  projectName: string;
  projectGlobalId: string;
  totalEntities: number;
  elementsWithGeometry: number;
  /** WGS84 location of the model + the projected CRS it was derived from. */
  location: { lat: number; lon: number; crs: string } | null;
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="finfo-row">
      <span className="finfo-k">{k}</span>
      <span className="finfo-v">{v}</span>
    </div>
  );
}

/**
 * File/model overview + an interactive location map (inspired by ifclite). The
 * map is an embedded OpenStreetMap frame with a marker; the links open the same
 * point in Google Maps / OpenStreetMap / Google Earth.
 */
export function FileInfoPanel({ info }: { info: FileInfo }) {
  const { t, lang } = useI18n();
  const loc = info.location;
  const n = (x: number) => Math.round(x).toLocaleString(lang === "en" ? "en-US" : "ro-RO");
  const mapSrc = loc
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${loc.lon - 0.012}%2C${
        loc.lat - 0.006
      }%2C${loc.lon + 0.012}%2C${loc.lat + 0.006}&layer=mapnik&marker=${loc.lat}%2C${loc.lon}`
    : "";

  return (
    <div className="finfo">
      <div className="finfo-sec">
        <h4>{t("props.fileInfo")}</h4>
        <InfoRow k={t("props.name")} v={info.fileName} />
        <InfoRow k={t("props.size")} v={`${n(info.fileSizeKB)} KB`} />
        <InfoRow k={t("props.schema")} v={info.schema} />
      </div>

      {(info.projectName || info.projectGlobalId) && (
        <div className="finfo-sec">
          <h4>{t("props.projectInfo")}</h4>
          {info.projectName && <InfoRow k={t("props.name")} v={info.projectName} />}
          {info.projectGlobalId && <InfoRow k="GlobalId" v={info.projectGlobalId} />}
        </div>
      )}

      <div className="finfo-sec">
        <h4>{t("props.statistics")}</h4>
        <InfoRow k={t("props.totalEntities")} v={n(info.totalEntities)} />
        <InfoRow k={t("props.elementsWithGeometry")} v={n(info.elementsWithGeometry)} />
      </div>

      {loc && (
        <div className="finfo-sec">
          <h4>{t("props.location")}</h4>
          <InfoRow k={t("props.crs")} v={loc.crs} />
          <InfoRow k={t("props.coords")} v={`${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`} />
          <div className="finfo-map">
            <iframe
              title={t("props.mapTitle")}
              className="finfo-map-frame"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={mapSrc}
            />
          </div>
          <div className="finfo-attrib">© OpenStreetMap</div>
          <div className="finfo-links">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${loc.lat}%2C${loc.lon}`}
              target="_blank"
              rel="noreferrer"
            >
              Google Maps
            </a>
            <a
              href={`https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=17/${loc.lat}/${loc.lon}`}
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap
            </a>
            <a
              href={`https://earth.google.com/web/search/${loc.lat},${loc.lon}`}
              target="_blank"
              rel="noreferrer"
            >
              Google Earth
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  groups: PropGroup[];
  /** Favorited property names (shared across element selections). */
  favorites: Set<string>;
  onToggleFavorite: (key: string) => void;
}

/**
 * Collapsible accordion: one section per property set (+ an "Atribute" section).
 * Each row can be starred as a favorite. Favorited properties are mirrored in an
 * always-open "Favorite" section pinned at the top, so they stay visible when
 * switching from one element to another (the per-set sections collapse on each
 * new selection, but favorites persist).
 */
export function PropAccordion({ groups, favorites, onToggleFavorite }: Props) {
  const { t } = useI18n();
  // Default: first group (Atribute) open, the rest collapsed.
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0].name] : []));
  const toggle = (n: string) =>
    setOpen((s) => {
      const x = new Set(s);
      x.has(n) ? x.delete(n) : x.add(n);
      return x;
    });

  // Build the pinned favourites list from the current element's rows (first
  // occurrence per property name wins).
  const favRows: PropRow[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const r of g.rows) {
      if (favorites.has(r.k) && !seen.has(r.k)) {
        seen.add(r.k);
        favRows.push(r);
      }
    }
  }

  const star = (k: string) => {
    const fav = favorites.has(k);
    return (
      <button
        type="button"
        className={"pacc-star" + (fav ? " on" : "")}
        title={fav ? t("props.unfavorite") : t("props.favorite")}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(k);
        }}
      >
        {fav ? "★" : "☆"}
      </button>
    );
  };

  const rows = (rs: PropRow[]) => (
    <table className="pacc-table">
      <tbody>
        {rs.map((r, i) => (
          <tr key={i} className={r.edited ? "pacc-edited-row" : undefined}>
            <td className="pacc-starcell">{star(r.k)}</td>
            <td className="k">
              {r.edited && <span className="pacc-edited" title={t("props.editedTitle")}>{t("props.editedBadge")}</span>}
              {r.k}
            </td>
            <td>{r.v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      {favRows.length > 0 && (
        <div className="pacc pacc-fav">
          <div className="pacc-head pacc-head-static">
            <span className="pacc-caret">★</span>
            <span className="pacc-name">{t("props.favorites")}</span>
            <span className="pacc-count">{favRows.length}</span>
          </div>
          {rows(favRows)}
        </div>
      )}

      {groups.map((g) => {
        const isOpen = open.has(g.name);
        return (
          <div className="pacc" key={g.name}>
            <button className="pacc-head" onClick={() => toggle(g.name)}>
              <span className="pacc-caret">{isOpen ? "▾" : "▸"}</span>
              <span className="pacc-name" title={g.name}>
                {g.name}
              </span>
              <span className="pacc-count">{g.rows.length}</span>
            </button>
            {isOpen && rows(g.rows)}
          </div>
        );
      })}
    </div>
  );
}
