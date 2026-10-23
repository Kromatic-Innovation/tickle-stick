import { describe, it, expect } from "vitest";
import { interpolatePrompt } from "../src/pipeline/prompt-interpolator.js";
import type { PipelineContext } from "../src/pipeline/context.js";
import type { WorkItem } from "../src/types.js";

function makeItem(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: "item-id",
    source: "gmail",
    type: "email",
    summary: "summary",
    timestamp: new Date("2026-10-23T00:00:00Z"),
    ...overrides,
  };
}

function emptyContext(allItems: WorkItem[]): PipelineContext {
  return {
    allItems,
    classified: [],
    stageOutputs: new Map(),
  };
}

describe("interpolatePrompt", () => {
  it("substitutes {{items}} and {{all_items}} with JSON projections", () => {
    const item = makeItem({ id: "item-1", summary: "Important meeting" });
    const rendered = interpolatePrompt(
      "Filtered: {{items}} All: {{all_items}}",
      [item],
      emptyContext([item]),
    );

    expect(rendered).toContain("Filtered: ");
    expect(rendered).toContain("All: ");
    expect(rendered).toContain("item-1");
    expect(rendered).toContain("Important meeting");
  });

  it("leaves unknown placeholders untouched", () => {
    const item = makeItem({});
    const rendered = interpolatePrompt(
      "Keep this: {{unknown_placeholder}} Items: {{items}}",
      [item],
      emptyContext([item]),
    );

    expect(rendered).toContain("{{unknown_placeholder}}");
  });

  it("substitutes a placeholder repeated in the template without re-expanding", () => {
    const item = makeItem({ id: "item-1" });
    const rendered = interpolatePrompt(
      "First: {{items}} --- Again: {{items}}",
      [item],
      emptyContext([item]),
    );

    expect(rendered).not.toContain("{{items}}");
    expect(rendered.split("item-1").length - 1).toBe(2);
  });

  // Regression test for the single-pass fix. Probe P4 (from the audit
  // corpus) is unreachable from this container, so this discharges AC2 as
  // a unit test: an item's own text contains the literal "{{items}}" and
  // "{{all_items}}" placeholder strings. Those strings only end up in the
  // rendered prompt because the "all_items" projection (substituted first
  // under the old two-pass implementation) carries them as ordinary JSON
  // string content — they must never be treated as placeholders to expand.
  //
  // With the old chained `.replaceAll("{{all_items}}", ...).replaceAll("{{items}}", ...)`
  // implementation, the first call splices the malicious item's text
  // (containing a literal "{{items}}") into the template, and the SECOND
  // call then re-scans that spliced-in text and matches the embedded
  // literal, duplicating the {{items}} payload (and its marker) into the
  // output. The fix (one `String.replace` over a regex, in a single pass
  // over the original template) must leave that embedded literal text
  // alone.
  it("does not re-expand {{items}}/{{all_items}} placeholder text that appears inside an item's own text (probe P4)", () => {
    const marker = "MARKER_TOKEN_UNIQUE";
    const maliciousItem = makeItem({
      id: "malicious-item",
      body: "This item's body needs {{items}} and {{all_items}} placeholders rendered literally.",
    });
    const markedItem = makeItem({ id: marker, summary: "clean item" });

    const template = "ALL_BLOCK={{all_items}} ITEMS_BLOCK={{items}}";
    const rendered = interpolatePrompt(
      template,
      [markedItem],
      emptyContext([maliciousItem]),
    );

    // The marker (from the {{items}} projection) must appear exactly once —
    // not duplicated into the {{all_items}} block via re-expansion of the
    // malicious item's embedded literal placeholder text.
    const markerOccurrences = rendered.split(marker).length - 1;
    expect(markerOccurrences).toBe(1);

    // The literal placeholder text inside the malicious item's own body
    // must survive unexpanded in the rendered output.
    expect(rendered).toContain(
      "This item's body needs {{items}} and {{all_items}} placeholders rendered literally.",
    );
  });
});
