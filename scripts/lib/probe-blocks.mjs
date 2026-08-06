/**
 * Extract named probe blocks from the review reference docs.
 *
 * The review docs tag each probe with a `<!-- probe: <id> -->` marker. This
 * module returns the contiguous block under that marker (until the next probe
 * marker or a top-level heading), so the review brief can inject only the
 * probe sections a run actually requires instead of the whole reference.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROBE_MARKER_RE = /<!--\s*probe:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*-->/g;
const HEADING_RE = /^#{1,6}\s/m;

const DEFAULT_DOCS = {
  bug: ["bug-review.md"],
  security: ["security-review.md"],
};

function resolveDoc(doc) {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "references", doc);
}

/**
 * Return all `<!-- probe: <id> -->` markers with their line offsets in a doc.
 *
 * @param {string} source
 * @returns {Array<{ id: string, start: number, end: number }>}
 */
export function probeMarkers(source) {
  const markers = [];
  PROBE_MARKER_RE.lastIndex = 0;
  let match;
  while ((match = PROBE_MARKER_RE.exec(source)) !== null) {
    const id = match[1];
    const start = match.index;
    markers.push({ id, start, end: start + match[0].length });
  }
  return markers;
}

/**
 * Extract the contiguous block for a probe id from a reference source.
 *
 * The block runs from the probe marker to the next probe marker or the next
 * top-level heading (`# ` or `## `), whichever comes first.
 *
 * @param {string} source
 * @param {string} probeId
 * @returns {{ found: boolean, text: string, startLine: number, endLine: number } | null}
 */
export function extractProbeBlock(source, probeId) {
  const markers = probeMarkers(source);
  const index = markers.findIndex((marker) => marker.id === probeId);
  if (index === -1) return null;
  const marker = markers[index];
  const nextMarker = markers[index + 1];
  const blockStart = marker.end;
  let blockEnd = source.length;
  if (nextMarker) blockEnd = nextMarker.start;

  // Trim to the next top-level heading if one appears before the next marker.
  const afterMarker = source.slice(blockStart, blockEnd);
  const headingMatch = HEADING_RE.exec(afterMarker);
  if (headingMatch && headingMatch.index < afterMarker.length) {
    blockEnd = blockStart + headingMatch.index;
  }

  const block = source.slice(blockStart, blockEnd).trim();
  const startLine = source.slice(0, blockStart).split("\n").length;
  const endLine = source.slice(0, blockEnd).split("\n").length;
  return { found: true, text: block, startLine, endLine };
}

/**
 * Extract probe blocks for a set of probe ids across the reference docs.
 *
 * @param {Array<{ id: string, axis: "bug" | "security" }>} probes
 * @param {object} [options]
 * @param {string} [options.root] repo root (defaults to this package)
 * @returns {Array<{ id: string, axis: string, doc: string, text: string, startLine: number, endLine: number }>}
 */
export function extractRequiredProbeBlocks(probes = [], { root } = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const base = root || join(here, "..", "..");
  const cache = new Map();
  const blocks = [];
  for (const { id, axis } of probes) {
    const docs = DEFAULT_DOCS[axis] || [];
    for (const doc of docs) {
      if (!cache.has(doc)) {
        cache.set(doc, readFileSync(join(base, "references", doc), "utf8"));
      }
      const source = cache.get(doc);
      const block = extractProbeBlock(source, id);
      if (block) {
        blocks.push({ id, axis, doc, ...block });
        break;
      }
    }
  }
  return blocks;
}
