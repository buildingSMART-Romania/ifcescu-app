import { describe, it, expect } from "vitest";
import { findTreePath, type TreeNode } from "../src/components/IfcTree";

const node = (expressID: number, children: TreeNode[] = [], type = "IFCWALL"): TreeNode => ({
  expressID,
  type,
  name: "",
  ids: [expressID],
  children,
});

// MODEL root → project → site → storey → walls, plus a second model.
const forest: TreeNode[] = [
  node(-1, [node(1, [node(2, [node(3, [node(10), node(11)]), node(12)], "IFCSITE")], "IFCPROJECT")], "MODEL"),
  node(-2, [node(1001, [node(1010)], "IFCPROJECT")], "MODEL"),
];

describe("findTreePath", () => {
  it("returns the ancestor chain, root first, excluding the node", () => {
    expect(findTreePath(forest, 11)).toEqual([-1, 1, 2, 3]);
    expect(findTreePath(forest, 12)).toEqual([-1, 1, 2]);
  });

  it("finds elements in a later (federated) model root", () => {
    expect(findTreePath(forest, 1010)).toEqual([-2, 1001]);
  });

  it("finds a branch node itself (spatial containers are selectable)", () => {
    expect(findTreePath(forest, 3)).toEqual([-1, 1, 2]);
    expect(findTreePath(forest, -1)).toEqual([]);
  });

  it("returns null when the id is not in this view", () => {
    expect(findTreePath(forest, 999)).toBeNull();
  });
});
