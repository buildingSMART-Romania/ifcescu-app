import { useRef, useState } from "react";
import type { IfcDataStore } from "@ifc-lite/parser";
import type { ViewerEngine } from "../viewer/engine";
import type { BCFProject, BCFTopic, BCFViewpoint } from "../ifc/bcf";
import {
  createBCFProject,
  createBCFTopic,
  createBCFComment,
  createViewpoint,
  addViewpointToTopic,
  addCommentToTopic,
  addTopicToProject,
  updateTopicStatus,
  removeTopicFromProject,
  readBCF,
  downloadBcf,
  expressIdsToGlobalIds,
} from "../ifc/bcf";
import { useI18n } from "../i18n/react";

const DEFAULT_AUTHOR = "viewer@ifc-lite";

// BCF enum values stay verbatim (they are written into the .bcfzip); only the
// field captions are translated. Project extensions can add more at runtime.
const STATUS_OPTIONS = ["Open", "In Progress", "Resolved", "Closed"];
const TYPE_OPTIONS = ["Issue", "Clash", "Error", "Warning", "Info", "Request"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High"];

/** Defaults + project extensions + the current value, de-duplicated. */
function mergedOptions(base: string[], extra: string[] | undefined, current?: string): string[] {
  const set = new Set<string>(base);
  for (const v of extra ?? []) set.add(v);
  if (current) set.add(current);
  return [...set];
}

interface Props {
  engine: ViewerEngine | null;
  store: IfcDataStore | null;
  fileName: string;
  /** Current selection (expressIDs) to embed in a new topic's viewpoint. */
  selectedIds: number[];
  /** Apply a viewpoint back into the viewer (camera + isolate + color + select). */
  onApplyViewpoint: (vp: BCFViewpoint) => void;
  /** Restore full visibility, clear viewpoint coloring and selection. */
  onResetView: () => void;
  bcfProject: BCFProject | null;
  onBcfProject: (p: BCFProject) => void;
  onClose: () => void;
}

/**
 * Docked BCF panel (lives in the 3D viewer, alongside the IDS panel — the user
 * switches between them from the toolbar). Create a topic from the live camera +
 * selection + snapshot, re-open a topic's viewpoint, and import/export .bcfzip.
 */
export function BcfPanel({
  engine,
  store,
  fileName,
  selectedIds,
  onApplyViewpoint,
  onResetView,
  bcfProject,
  onBcfProject,
  onClose,
}: Props) {
  const { t, lang } = useI18n();
  const importRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState(DEFAULT_AUTHOR);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Collaboration UI state.
  const [openGuid, setOpenGuid] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [attachView, setAttachView] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const topics = bcfProject ? [...bcfProject.topics.values()] : [];
  const ext = bcfProject?.extensions;
  const fmtDate = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleString(lang === "en" ? "en-GB" : "ro-RO", { dateStyle: "medium", timeStyle: "short" });
  };

  /** Propagate an in-place mutation of the project to React/App. */
  const applyProject = () => bcfProject && onBcfProject({ ...bcfProject });

  const setStatus = (topic: BCFTopic, value: string) => {
    updateTopicStatus(topic, value, author.trim() || DEFAULT_AUTHOR);
    applyProject();
  };
  const setField = (topic: BCFTopic, patch: Partial<BCFTopic>) => {
    Object.assign(topic, patch);
    topic.modifiedDate = new Date().toISOString();
    topic.modifiedAuthor = author.trim() || DEFAULT_AUTHOR;
    applyProject();
  };

  const addComment = async (topic: BCFTopic) => {
    const text = commentDraft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      let viewpointGuid: string | undefined;
      if (attachView && engine && store) {
        const camera = engine.getCameraState();
        const bounds = engine.getModelBoundsState() ?? undefined;
        const selectedGuids = expressIdsToGlobalIds(store, selectedIds);
        const snapshot = await engine.screenshot();
        const vp = createViewpoint({ camera, bounds, selectedGuids, snapshot: snapshot ?? undefined });
        addViewpointToTopic(topic, vp);
        viewpointGuid = vp.guid;
      }
      addCommentToTopic(topic, createBCFComment({ author: author.trim() || DEFAULT_AUTHOR, comment: text, viewpointGuid }));
      topic.modifiedDate = new Date().toISOString();
      topic.modifiedAuthor = author.trim() || DEFAULT_AUTHOR;
      applyProject();
      setCommentDraft("");
    } catch (e: any) {
      setError(t("bcf.createError", { detail: e?.message ?? "" }));
    } finally {
      setBusy(false);
    }
  };

  const deleteTopic = (topic: BCFTopic) => {
    if (!bcfProject) return;
    removeTopicFromProject(bcfProject, topic.guid);
    onBcfProject({ ...bcfProject });
    setConfirmDelete(null);
    if (openGuid === topic.guid) setOpenGuid(null);
  };

  const applyViewpointByGuid = (topic: BCFTopic, guid: string) => {
    const vp = topic.viewpoints.find((v) => v.guid === guid);
    if (vp) onApplyViewpoint(vp);
  };

  const createTopic = async () => {
    if (!engine || !store || !title.trim()) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const camera = engine.getCameraState();
      const bounds = engine.getModelBoundsState() ?? undefined;
      const selectedGuids = expressIdsToGlobalIds(store, selectedIds);
      const snapshot = await engine.screenshot();
      const viewpoint = createViewpoint({ camera, bounds, selectedGuids, snapshot: snapshot ?? undefined });
      const topic = createBCFTopic({
        title: title.trim(),
        description: description.trim() || undefined,
        author: author.trim() || DEFAULT_AUTHOR,
        topicType: "Issue",
        topicStatus: "Open",
      });
      addViewpointToTopic(topic, viewpoint);
      const project = bcfProject ?? createBCFProject({ name: fileName, version: "2.1" });
      addTopicToProject(project, topic);
      onBcfProject({ ...project });
      setTitle("");
      setDescription("");
      setNote(t("bcf.topicCreated"));
    } catch (e: any) {
      setError(t("bcf.createError", { detail: e?.message ?? "" }));
    } finally {
      setBusy(false);
    }
  };

  const openTopic = (topic: BCFTopic) => {
    const vp = topic.viewpoints[0];
    if (vp) onApplyViewpoint(vp);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const imported = await readBCF(file);
      if (bcfProject) {
        for (const topic of imported.topics.values()) addTopicToProject(bcfProject, topic);
        onBcfProject({ ...bcfProject });
      } else {
        onBcfProject(imported);
      }
      setNote(t("bcf.imported", { n: imported.topics.size }));
    } catch (e: any) {
      setError(t("bcf.readError", { detail: e?.message ?? "" }));
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    if (!bcfProject) return;
    setBusy(true);
    setError(null);
    try {
      await downloadBcf(bcfProject, `${fileName.replace(/\.ifc$/i, "")}.bcfzip`);
    } catch (e: any) {
      setError(t("bcf.exportError", { detail: e?.message ?? "" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ids-panel">
      <div className="ids-head">
        <span className="ids-head-title">💬 {t("bcf.title")}</span>
        <div className="ids-head-actions">
          <button className="ids-icon" title={t("bcf.resetView")} onClick={onResetView}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          </button>
          <button className="ids-icon" title={t("bcf.import")} onClick={() => importRef.current?.click()} disabled={busy}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
          </button>
          <button className="ids-icon" title={t("bcf.export")} onClick={onExport} disabled={busy || topics.length === 0}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>
          </button>
          <button className="ids-icon" title={t("common.close")} onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".bcfzip,.bcf,application/zip"
        style={{ display: "none" }}
        onChange={(e) => {
          onImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="ids-panel-body">
        <div className="bcf-form">
          <label className="bcf-label">{t("bcf.titleField")}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("bcf.titlePlaceholder")} />
          <label className="bcf-label">{t("bcf.description")}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder={t("common.optional")}
          />
          <label className="bcf-label">{t("bcf.author")}</label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          <button className="btn" onClick={createTopic} disabled={busy || !title.trim() || !engine}>
            {t("bcf.newTopic")}
          </button>
          <div className="bcf-hint">
            {selectedIds.length
              ? t("bcf.willInclude", { n: selectedIds.length })
              : t("bcf.nothingSelected")}
          </div>
          {note && <div className="bcf-note">{note}</div>}
          {error && <div className="alert error">⛔ {error}</div>}
        </div>

        <div className="bcf-topics">
          <div className="bcf-topics-head">{t("bcf.topicsHead", { n: topics.length })}</div>
          {topics.length === 0 ? (
            <div className="bcf-empty">{t("bcf.noTopics")}</div>
          ) : (
            <ul>
              {topics.map((topic) => {
                const open = openGuid === topic.guid;
                return (
                  <li key={topic.guid} className={"bcf-topic" + (open ? " open" : "")}>
                    <div className="bcf-topic-row" onClick={() => setOpenGuid(open ? null : topic.guid)}>
                      <span className="bcf-topic-caret">{open ? "▾" : "▸"}</span>
                      <div className="bcf-topic-info">
                        <div className="bcf-topic-title">{topic.title}</div>
                        <div className="bcf-topic-meta">
                          {[topic.topicType, topic.topicStatus].filter(Boolean).join(" · ")}
                          {` · ${t("bcf.commentsViewpoints", { c: topic.comments.length, v: topic.viewpoints.length })}`}
                        </div>
                      </div>
                      {topic.viewpoints.length > 0 && (
                        <button className="bcf-open" onClick={(e) => { e.stopPropagation(); openTopic(topic); }} title={t("bcf.openView")}>
                          ↗ 3D
                        </button>
                      )}
                      <button className="bcf-del" onClick={(e) => { e.stopPropagation(); setConfirmDelete(topic.guid); }} title={t("bcf.delete")}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                      </button>
                    </div>

                    {confirmDelete === topic.guid && (
                      <div className="bcf-confirm">
                        <span>{t("bcf.deleteConfirm")}</span>
                        <button className="btn small danger" onClick={() => deleteTopic(topic)}>{t("bcf.delete")}</button>
                        <button className="btn small secondary" onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</button>
                      </div>
                    )}

                    {open && (
                      <div className="bcf-topic-detail">
                        {topic.description && <div className="bcf-topic-desc">{topic.description}</div>}

                        <div className="bcf-fields">
                          <label>{t("bcf.status")}
                            <select value={topic.topicStatus ?? ""} onChange={(e) => setStatus(topic, e.target.value)}>
                              {mergedOptions(STATUS_OPTIONS, ext?.topicStatuses, topic.topicStatus).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </label>
                          <label>{t("bcf.type")}
                            <select value={topic.topicType ?? ""} onChange={(e) => setField(topic, { topicType: e.target.value })}>
                              {mergedOptions(TYPE_OPTIONS, ext?.topicTypes, topic.topicType).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </label>
                          <label>{t("bcf.priority")}
                            <select value={topic.priority ?? ""} onChange={(e) => setField(topic, { priority: e.target.value || undefined })}>
                              <option value="">{t("bcf.none")}</option>
                              {mergedOptions(PRIORITY_OPTIONS, ext?.priorities, topic.priority).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </label>
                          <label>{t("bcf.assignee")}
                            <input type="text" value={topic.assignedTo ?? ""} placeholder={t("bcf.none")} onChange={(e) => setField(topic, { assignedTo: e.target.value || undefined })} />
                          </label>
                          <label>{t("bcf.dueDate")}
                            <input type="date" value={topic.dueDate ? topic.dueDate.slice(0, 10) : ""} onChange={(e) => setField(topic, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
                          </label>
                        </div>

                        <div className="bcf-comments">
                          {topic.comments.length === 0 ? (
                            <div className="bcf-comments-empty">{t("bcf.noComments")}</div>
                          ) : (
                            topic.comments.map((c) => (
                              <div key={c.guid} className="bcf-comment">
                                <div className="bcf-comment-head">
                                  <span className="bcf-comment-author">{c.author}</span>
                                  <span className="bcf-comment-date">{fmtDate(c.date)}</span>
                                  {c.viewpointGuid && (
                                    <button className="bcf-comment-vp" title={t("bcf.openView")} onClick={() => applyViewpointByGuid(topic, c.viewpointGuid!)}>↗</button>
                                  )}
                                </div>
                                <div className="bcf-comment-text">{c.comment}</div>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="bcf-add-comment">
                          <textarea
                            value={openGuid === topic.guid ? commentDraft : ""}
                            rows={2}
                            placeholder={t("bcf.commentPlaceholder")}
                            onChange={(e) => setCommentDraft(e.target.value)}
                          />
                          <label className="bcf-attach">
                            <input type="checkbox" checked={attachView} onChange={(e) => setAttachView(e.target.checked)} disabled={!engine} />
                            {t("bcf.attachView")}
                          </label>
                          <button className="btn small" onClick={() => addComment(topic)} disabled={busy || !commentDraft.trim()}>
                            {t("bcf.addComment")}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
