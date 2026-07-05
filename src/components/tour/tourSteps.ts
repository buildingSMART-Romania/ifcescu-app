import type { I18nKey } from "../../i18n";

/** One spotlight stop. `target` matches a [data-tour="…"] attribute in the UI.
 *  Steps whose target is missing or hidden at runtime (gated module, disabled
 *  tab, setting turned off) are skipped automatically by the overlay. */
export interface TourStep {
  target: string;
  titleKey: I18nKey;
  bodyKey: I18nKey;
}

export const TOUR_STEPS: TourStep[] = [
  { target: "tree", titleKey: "tour.treeTitle", bodyKey: "tour.treeBody" },
  { target: "canvas", titleKey: "tour.canvasTitle", bodyKey: "tour.canvasBody" },
  { target: "measure", titleKey: "tour.measureTitle", bodyKey: "tour.measureBody" },
  { target: "sectionTool", titleKey: "tour.sectionTitle", bodyKey: "tour.sectionBody" },
  { target: "visibility", titleKey: "tour.visibilityTitle", bodyKey: "tour.visibilityBody" },
  { target: "views", titleKey: "tour.viewsTitle", bodyKey: "tour.viewsBody" },
  { target: "filter", titleKey: "tour.filterTitle", bodyKey: "tour.filterBody" },
  { target: "ids", titleKey: "tour.idsTitle", bodyKey: "tour.idsBody" },
  { target: "bcf", titleKey: "tour.bcfTitle", bodyKey: "tour.bcfBody" },
  { target: "table", titleKey: "tour.tableTitle", bodyKey: "tour.tableBody" },
  { target: "clash", titleKey: "tour.clashTitle", bodyKey: "tour.clashBody" },
  { target: "globeTab", titleKey: "tour.globeTitle", bodyKey: "tour.globeBody" },
  { target: "help", titleKey: "tour.helpTitle", bodyKey: "tour.helpBody" },
];
