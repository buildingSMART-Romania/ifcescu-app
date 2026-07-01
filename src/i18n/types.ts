import { ro } from "./ro";

export type Lang = "ro" | "en";

/** The dictionary shape — Romanian is the structural source of truth. */
export type Dict = typeof ro;

/** Union of every leaf dot-path in the dictionary (e.g. "common.save"). */
export type I18nKey = Leaves<Dict>;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
