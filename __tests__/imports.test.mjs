import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";
import * as logic from "../src/logic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, "..", rel), "utf-8");
const html = read("src/index.html");
const shareSrc = read("src/share.js");
const modalSrc = read("src/modal.js");

/**
 * The page is one inline module, so nothing type-checks it and the build only
 * parses it — a helper that is USED but never IMPORTED is a ReferenceError that
 * appears the first time the branch renders, not at build time. The share
 * button shipped exactly that bug: `isAdult(...)` in the header with no import.
 */
function importsFrom(source, spec) {
  const re = new RegExp(`import \\{([^}]*)\\} from "${spec.replace(/[.]/g, "\\.")}";`);
  return new Set((source.match(re)?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean));
}
/** The source with its import statements removed: what is left is every USE. */
const uses = (source) => source.replace(/import \{[^}]*\} from "[^"]*";/g, "");

describe.each([
  ["src/index.html", html, "./logic.js"],
  ["src/share.js", shareSrc, "./logic.js"],
])("%s imports what it uses", (_name, source, spec) => {
  const imported = importsFrom(source, spec);
  const body = uses(source);

  it("imports every logic.js export it calls", () => {
    const missing = Object.keys(logic)
      .filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(body))
      .filter((name) => !imported.has(name));
    expect(missing, `used but not imported: ${missing.join(", ")}`).toEqual([]);
  });

  it("imports nothing logic.js does not export", () => {
    const exported = new Set(Object.keys(logic));
    expect([...imported].filter((n) => !exported.has(n))).toEqual([]);
  });

  // The other direction, and the one a refactor leaves behind: moving a call
  // into a helper drops the last use, and the import stays as a dead name that
  // reads like the file still does the thing.
  it("imports nothing it no longer uses", () => {
    const unused = [...imported].filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(body));
    expect(unused, `imported but unused: ${unused.join(", ")}`).toEqual([]);
  });
});

/**
 * A structural invariant, not a behaviour. `createModal.open` tears down the
 * previous modal BEFORE building the next one, so any modal-scoped state kept
 * beside it is state that teardown can clear — which is how the share modal
 * once came to open with no target at all, rendering nothing and sending a null
 * member_id at a NOT NULL column. Binding the target to the element makes the
 * hazard unreachable rather than merely fixed, and these pin that shape.
 *
 * __tests__/share-ui.test.mjs covers the behaviour; this covers the reason.
 */
describe("share modal state is bound to the modal", () => {
  it("tears the modal down without touching share state", () => {
    const close = modalSrc.match(/function close\(\)\s*\{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(close, "close() should be findable").not.toBe("");
    expect(close, "close() must only drop the element").not.toMatch(/share/i);
  });

  it("reads the share target off the element rather than holding it", () => {
    expect(shareSrc).toMatch(/const target = \(\) => shareTargetOf\(/);
    // A mutable module-level target is the shape that broke; a const arrow is not.
    expect(shareSrc).not.toMatch(/^\s*let\s+(share)?[Tt]arget\b/m);
    expect(html).not.toMatch(/^\s*let\s+shareTarget\b/m);
  });
});
