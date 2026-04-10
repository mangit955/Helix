import test from "node:test";
import assert from "node:assert/strict";
import { getUserName } from "../dist/index.js";

test("returns uppercase name", () => {
  assert.equal(getUserName({ profile: { name: "manas" } }), "MANAS");
});
