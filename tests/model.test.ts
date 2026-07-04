import { describe, it, expect } from "vitest";
import { parseStore } from "../src/ifc/store";
import {
  buildTree,
  buildClassTree,
  buildMaterialTree,
  offsetTree,
  modelRootNode,
  prettyIfcType,
  entityType,
  entityName,
} from "../src/viewer/model";
import type { TreeNode } from "../src/components/IfcTree";

// Inline IFC4 fixture (same pattern as pivot.test.ts): project → site containing
// two walls + a slab; one wall gets a material so buildMaterialTree exercises
// both the material group and the trailing "no material" bucket.
const IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('t.ifc','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'P',$,$,$,$,$,$);
#2=IFCSITE('0site0000000000000000A',$,'S',$,$,$,$,$,$,$,$,$,$,$);
#10=IFCWALL('1wall0000000000000000A',$,'W1',$,$,$,$,$,$);
#11=IFCWALL('1wall0000000000000000B',$,'W2',$,$,$,$,$,$);
#12=IFCSLAB('1slab0000000000000000A',$,'S1',$,$,$,$,$,$);
#40=IFCRELAGGREGATES('6rel00000000000000000A',$,$,$,#1,(#2));
#41=IFCRELCONTAINEDINSPATIALSTRUCTURE('6rel00000000000000000B',$,$,$,(#10,#11,#12),#2);
#50=IFCMATERIAL('Concrete',$,$);
#51=IFCRELASSOCIATESMATERIAL('7rel00000000000000000A',$,$,$,(#10),#50);
ENDSEC;
END-ISO-10303-21;
`;

const ALL = new Set([10, 11, 12]);

async function fixture() {
  return parseStore(new TextEncoder().encode(IFC));
}

describe("model.entity accessors", () => {
  it("resolves type and name per express id", async () => {
    const store = await fixture();
    expect(entityType(store, 10)).toBe("IFCWALL");
    expect(entityName(store, 10)).toBe("W1");
    expect(entityType(store, 12)).toBe("IFCSLAB");
  });
});

describe("model.buildTree", () => {
  it("builds project → site with the renderable elements as leaves", async () => {
    const store = await fixture();
    const root = buildTree(store, ALL);
    expect(root).not.toBeNull();
    expect(root!.type).toBe("IFCPROJECT");
    const site = root!.children.find((c) => c.type === "IFCSITE");
    expect(site).toBeDefined();
    const leafIds = site!.children.map((c) => c.expressID).sort();
    expect(leafIds).toEqual([10, 11, 12]);
    // Container rows stay selectable: the aggregated ids include the containers.
    expect(root!.ids).toContain(1);
    expect(root!.ids).toContain(2);
    expect(root!.ids).toEqual(expect.arrayContaining([10, 11, 12]));
  });

  it("filters leaves to the renderable set", async () => {
    const store = await fixture();
    const root = buildTree(store, new Set([10]));
    const site = root!.children.find((c) => c.type === "IFCSITE")!;
    expect(site.children.map((c) => c.expressID)).toEqual([10]);
  });
});

describe("model.buildClassTree", () => {
  it("groups renderable elements per class, sorted, with unique synthetic ids", async () => {
    const store = await fixture();
    const groups = buildClassTree(store, ALL);
    expect(groups.map((g) => g.type)).toEqual(["IFCSLAB", "IFCWALL"]);
    const walls = groups[1];
    expect(walls.count).toBe(2);
    expect(walls.children.map((c) => c.expressID)).toEqual([10, 11]);
    // Synthetic group ids are negative and unique (never collide with entities).
    const ids = groups.map((g) => g.expressID);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops classes with no renderable member", async () => {
    const store = await fixture();
    const groups = buildClassTree(store, new Set([12]));
    expect(groups.map((g) => g.type)).toEqual(["IFCSLAB"]);
  });
});

describe("model.buildMaterialTree", () => {
  it("groups by material and buckets the rest under a trailing group", async () => {
    const store = await fixture();
    const groups = buildMaterialTree(store, ALL);
    const concrete = groups.find((g) => g.name === "Concrete");
    expect(concrete).toBeDefined();
    expect(concrete!.children.map((c) => c.expressID)).toEqual([10]);
    // #11 + #12 have no material → the last group is the no-material bucket.
    const bucket = groups[groups.length - 1];
    expect(bucket.children.map((c) => c.expressID).sort()).toEqual([11, 12]);
  });
});

describe("model.offsetTree / modelRootNode", () => {
  const tree: TreeNode = {
    expressID: 5,
    type: "IFCWALL",
    name: "w",
    ids: [5, 6],
    children: [
      { expressID: -1, type: "GROUP", name: "g", ids: [6], children: [] },
      { expressID: 6, type: "IFCDOOR", name: "d", ids: [6], children: [] },
    ],
  };

  it("shifts positive express ids and every renderable id; keeps synthetic ids", () => {
    const out = offsetTree(tree, 1000);
    expect(out.expressID).toBe(1005);
    expect(out.ids).toEqual([1005, 1006]);
    expect(out.children[0].expressID).toBe(-1); // synthetic group row untouched
    expect(out.children[0].ids).toEqual([1006]); // ...but its ids still shift
    expect(out.children[1].expressID).toBe(1006);
    // The input tree is not mutated.
    expect(tree.expressID).toBe(5);
    expect(tree.ids).toEqual([5, 6]);
  });

  it("wraps a forest in a MODEL root with the file name and global ids", () => {
    const root = modelRootNode(-100, "casa.ifc", [tree], [1005, 1006]);
    expect(root).toMatchObject({ expressID: -100, type: "MODEL", name: "casa.ifc", count: 2, defaultOpen: true });
    expect(root.children).toEqual([tree]);
  });
});

describe("model.prettyIfcType", () => {
  it("formats raw IFC class names and passes anything else through", () => {
    expect(prettyIfcType("IFCCOLUMN")).toBe("IfcColumn");
    expect(prettyIfcType("IFCWALLSTANDARDCASE")).toBe("IfcWallstandardcase");
    expect(prettyIfcType("")).toBe("");
    expect(prettyIfcType("MODEL")).toBe("MODEL");
  });
});
