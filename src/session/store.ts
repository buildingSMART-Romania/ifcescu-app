// The last session (open models, IDS, BCF, camera, measurements), kept in the
// browser's IndexedDB so a page refresh reopens the project instead of losing it.
// Nothing leaves the device. localStorage would be too small for IFC files.
//
// Two records: "models" (the IFC bytes — rewritten only when the model set
// changes) and "state" (everything else — small, saved often, merged per field).
import type { ViewerCameraState } from "@ifc-lite/bcf";
import type { Measurement } from "../viewer/measure";

const DB_NAME = "ifcescu-session";
const STORE = "kv";

export interface SessionModel {
  fileName: string;
  bytes: Uint8Array;
  primary: boolean;
}

export interface SessionState {
  /** The IDS document as IDS XML (loaded or authored). */
  idsXml?: string;
  /** The IDS had been validated: re-run the validation on restore. */
  idsValidated?: boolean;
  /** The BCF project as a .bcfzip. */
  bcf?: Blob;
  camera?: ViewerCameraState;
  measures?: Measurement[];
}

export interface Session {
  models: SessionModel[];
  state: SessionState;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run one transaction on the store; resolves with the request's result once committed. */
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** The saved session, or null when there is none (or storage is unavailable). */
export async function loadSession(): Promise<Session | null> {
  try {
    const models = (await tx<SessionModel[]>("readonly", (s) => s.get("models"))) ?? [];
    if (!models.some((m) => m.primary)) return null;
    const state = (await tx<SessionState>("readonly", (s) => s.get("state"))) ?? {};
    return { models, state };
  } catch {
    return null; // private mode / blocked storage: just start fresh
  }
}

/** Replace the saved models (primary first). */
export async function saveModels(models: SessionModel[]): Promise<void> {
  try {
    await tx("readwrite", (s) => { s.put(models, "models"); });
  } catch {
    /* storage full or unavailable: the session just won't survive a refresh */
  }
}

/** Merge fields into the saved state (undefined clears a field). Read + write
 *  happen in ONE transaction, so concurrent saves (camera, BCF, IDS) can't
 *  overwrite each other's fields. */
export async function saveState(patch: Partial<SessionState>): Promise<void> {
  try {
    await tx("readwrite", (s) => {
      const get = s.get("state");
      get.onsuccess = () => { s.put(mergeState((get.result as SessionState | undefined) ?? {}, patch), "state"); };
    });
  } catch {
    /* see saveModels */
  }
}

/** Forget the session (Close project / a new primary model). */
export async function clearSession(keepModels = false): Promise<void> {
  try {
    await tx("readwrite", (s) => {
      s.delete("state");
      if (!keepModels) s.delete("models");
    });
  } catch {
    /* nothing to clear */
  }
}

/** Patch merge where an explicit `undefined` removes the field. */
export function mergeState(cur: SessionState, patch: Partial<SessionState>): SessionState {
  const next: SessionState = { ...cur };
  for (const [k, v] of Object.entries(patch) as [keyof SessionState, unknown][]) {
    if (v === undefined) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  return next;
}
