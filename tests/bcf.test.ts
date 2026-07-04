import { describe, it, expect } from "vitest";
import {
  createBCFProject, createBCFTopic, createBCFComment,
  addTopicToProject, addCommentToTopic, addViewpointToTopic,
  createViewpoint, createBCFFromIDSReport, writeBCF, readBCF, readBcfFile,
  type BCFProject,
} from "../src/ifc/bcf";
// JSZip is a transitive dependency of @ifc-lite/bcf (its own zip engine),
// imported here ONLY to assert the .bcfzip structure in tests.
import JSZip from "jszip";

// BCF conformance: the exported .bcfzip is the exam deliverable — an external
// evaluator opens it in another tool, so a full headless round-trip
// (writeBCF → readBCF) plus a zip-structure check guards interoperability.

const GUID_A = "1wall0000000000000000A";
const GUID_B = "1slab0000000000000000A";

// Minimal valid 1×1 PNG (exercises the snapshot path without a canvas).
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function buildProject(): BCFProject {
  const project = createBCFProject({ name: "Exam project", version: "2.1" });
  const topic = createBCFTopic({
    title: 'Clash: wall, "fire" rated <F60>',
    description: "Wall overlaps the slab & must move.",
    author: "candidate@example.com",
    topicType: "Clash",
    topicStatus: "Open",
    priority: "High",
    assignedTo: "reviewer@example.com",
    dueDate: "2026-08-01",
    labels: ["exam", "structural"],
  });
  addTopicToProject(project, topic);
  addCommentToTopic(topic, createBCFComment({
    author: "candidate@example.com",
    comment: 'See viewpoint, value is "F30", expected <F60>.',
  }));
  addViewpointToTopic(topic, createViewpoint({
    camera: {
      position: { x: 10, y: 5, z: 8 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: Math.PI / 3,
    },
    selectedGuids: [GUID_A, GUID_B],
    snapshotData: PNG_1PX,
  }));
  return project;
}

describe("BCF 2.1 round-trip (writeBCF → readBCF)", () => {
  it("preserves project, topic metadata, comments, selection and snapshot", async () => {
    const blob = await writeBCF(buildProject());
    // readBcfFile is the app's import path: library read + repair pass (the raw
    // library reader loses comment text and leaves XML entities encoded).
    const read = await readBcfFile(await blob.arrayBuffer());

    expect(read.name).toBe("Exam project");
    expect(read.version).toBe("2.1");
    expect(read.topics.size).toBe(1);

    const topic = [...read.topics.values()][0];
    expect(topic.title).toBe('Clash: wall, "fire" rated <F60>');
    expect(topic.description).toBe("Wall overlaps the slab & must move.");
    expect(topic.topicType).toBe("Clash");
    expect(topic.topicStatus).toBe("Open");
    expect(topic.priority).toBe("High");
    expect(topic.assignedTo).toBe("reviewer@example.com");
    expect(topic.dueDate).toContain("2026-08-01");
    expect(topic.labels).toEqual(expect.arrayContaining(["exam", "structural"]));

    expect(topic.comments).toHaveLength(1);
    expect(topic.comments[0].comment).toBe('See viewpoint, value is "F30", expected <F60>.');
    expect(topic.comments[0].author).toBe("candidate@example.com");

    expect(topic.viewpoints).toHaveLength(1);
    const vp = topic.viewpoints[0];
    // BCF-side camera fields (the viewer camera is lossy by design — Y-up⇄Z-up).
    const cam = vp.perspectiveCamera!;
    expect(cam).toBeTruthy();
    expect(cam.fieldOfView).toBeGreaterThan(0);
    for (const k of ["cameraViewPoint", "cameraDirection", "cameraUpVector"] as const) {
      const v = cam[k] as { x: number; y: number; z: number };
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
    }
    // Selection components survive with their GUIDs.
    const selGuids = (vp.components?.selection ?? []).map((c: any) => c.ifcGuid);
    expect(selGuids.sort()).toEqual([GUID_A, GUID_B].sort());
    // Snapshot survives.
    expect(vp.snapshot ?? (vp as any).snapshotData).toBeTruthy();
  });

  it("emits the standard BCF 2.1 zip structure", async () => {
    const project = buildProject();
    const blob = await writeBCF(project);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);

    expect(names).toContain("bcf.version");
    const version = await zip.files["bcf.version"].async("string");
    expect(version).toContain("2.1");

    const topicGuid = [...project.topics.keys()][0];
    expect(names).toContain(`${topicGuid}/markup.bcf`);
    expect(names.some((n) => new RegExp(`^${topicGuid}/Viewpoint_.+\\.bcfv$`).test(n) || n === `${topicGuid}/viewpoint.bcfv`)).toBe(true);
    expect(names.some((n) => n.startsWith(`${topicGuid}/`) && n.endsWith(".png"))).toBe(true);

    const markup = await zip.files[`${topicGuid}/markup.bcf`].async("string");
    // XML-escaped title with quotes/angle brackets intact after escaping.
    expect(markup).toContain("&quot;fire&quot;");
    expect(markup).toContain("&lt;F60&gt;");
  });
});

describe("upstream reader defects (sentinel)", () => {
  // Documents WHY readBcfFile's repair pass exists. If this test starts
  // failing after an @ifc-lite/bcf upgrade, the upstream reader was fixed and
  // the repair in src/ifc/bcf.ts can be removed.
  it("raw readBCF loses comment text (worked around by readBcfFile)", async () => {
    const blob = await writeBCF(buildProject());
    const raw = await readBCF(await blob.arrayBuffer());
    const topic = [...raw.topics.values()][0];
    expect(topic.comments[0].comment).toBe("");
  });
});

describe("IDS → BCF viewpoints (camera + snapshot)", () => {
  const reportInput = (withGeometry: boolean) => {
    const entityBounds = withGeometry
      ? new Map([["model:10", { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 2 } }]])
      : undefined;
    const entitySnapshots = withGeometry ? new Map([["model:10", "data:image/png;base64," + Buffer.from(PNG_1PX).toString("base64")]]) : undefined;
    return {
      input: {
        title: "Exam spec",
        specificationResults: [
          {
            specification: { name: "Walls fire rated" },
            status: "fail" as const,
            applicableCount: 1,
            passedCount: 0,
            failedCount: 1,
            entityResults: [
              {
                expressId: 10, modelId: "model", entityType: "IfcWall", entityName: "Wall A",
                globalId: GUID_A, passed: false,
                requirementResults: [{ status: "fail" as const, facetType: "property", checkedDescription: "FireRating must be F60", failureReason: "Value is F30" }],
              },
            ],
          },
        ],
      },
      opts: { projectName: "Exam spec", version: "2.1" as const, entityBounds, entitySnapshots },
    };
  };

  it("emits a perspective camera + snapshot + selection when bounds/snapshots are supplied", async () => {
    const { input, opts } = reportInput(true);
    const generated = createBCFFromIDSReport(input, opts);
    const read = await readBcfFile(await (await writeBCF(generated)).arrayBuffer());
    const topic = [...read.topics.values()][0];
    const vp = topic.viewpoints[0];
    expect(vp).toBeTruthy();
    // Camera present with finite fields → BCF tools frame the failing element.
    const cam = vp.perspectiveCamera!;
    expect(cam).toBeTruthy();
    expect(cam.fieldOfView).toBeGreaterThan(0);
    for (const k of ["cameraViewPoint", "cameraDirection", "cameraUpVector"] as const) {
      const v = cam[k] as { x: number; y: number; z: number };
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
    }
    // Snapshot thumbnail present, and the element is selected in the viewpoint.
    expect(vp.snapshot ?? (vp as any).snapshotData).toBeTruthy();
    expect((vp.components?.selection ?? []).map((c: any) => c.ifcGuid)).toContain(GUID_A);
  });

  it("without bounds/snapshots the viewpoint is components-only (the pre-fix bug)", async () => {
    const { input, opts } = reportInput(false);
    const generated = createBCFFromIDSReport(input, opts);
    const topic = [...generated.topics.values()][0];
    // Selection is still there, but no camera → BIMcollab shows no viewpoint.
    expect(topic.viewpoints[0].perspectiveCamera).toBeFalsy();
    expect((topic.viewpoints[0].components?.selection ?? []).length).toBeGreaterThan(0);
  });
});

describe("IDS → BCF reporter round-trip", () => {
  it("creates one topic per failing entity and survives write/read", async () => {
    const generated = createBCFFromIDSReport(
      {
        title: "Exam spec",
        specificationResults: [
          {
            specification: { name: "Walls fire rated" },
            status: "fail",
            applicableCount: 2,
            passedCount: 1,
            failedCount: 1,
            entityResults: [
              {
                expressId: 10,
                modelId: "model",
                entityType: "IfcWall",
                entityName: "Wall A",
                globalId: GUID_A,
                passed: false,
                requirementResults: [
                  {
                    status: "fail",
                    facetType: "property",
                    checkedDescription: "FireRating must be F60",
                    failureReason: "Value is F30",
                  },
                ],
              },
            ],
          },
        ],
      },
      { projectName: "Exam spec", version: "2.1" },
    );

    expect(generated.topics.size).toBe(1);
    const read = await readBcfFile(await (await writeBCF(generated)).arrayBuffer());
    expect(read.topics.size).toBe(1);
    const topic = [...read.topics.values()][0];
    expect(topic.title).toContain("IfcWall");
    // The failure detail lands in the topic body (description or a comment).
    const text = [topic.description ?? "", ...topic.comments.map((c) => c.comment)].join("\n");
    expect(text).toContain("FireRating must be F60");
  });
});
