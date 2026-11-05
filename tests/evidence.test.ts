import { describe, expect, it } from "vitest";
import { validateLinks } from "../agent/lib/evidence/attachments.js";
import { defaultEvidence } from "../agent/lib/profile/store.js";

describe("evidence", () => {
  it("rechaza enlaces con secretos", () => {
    const r = validateLinks(
      ["https://example.com/file?token=abc"],
      defaultEvidence(),
    );
    expect(r.ok).toBe(false);
  });

  it("acepta https limpio", () => {
    const r = validateLinks(["https://dev.azure.com/org/project/_git/repo/commit/abc"], defaultEvidence());
    expect(r.ok).toBe(true);
  });
});
