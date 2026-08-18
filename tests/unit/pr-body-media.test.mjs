import assert from "node:assert/strict";
import test from "node:test";

import { diffPrBodyMedia, extractPrBodyMedia } from "../../scripts/lib/pr-body-media.mjs";

test("extracts Markdown images, recognized media links, HTML media and GitHub uploads", () => {
  const body = [
    "![shot](https://example.com/a.png)",
    "[demo](https://example.com/demo.mp4)",
    '<img alt="other" src="https://example.com/b.webp">',
    '<video controls src="https://example.com/c.webm"></video>',
    '<source src="https://example.com/d.mp4" type="video/mp4">',
    "https://github.com/user-attachments/assets/11111111-2222-3333-4444-555555555555",
    "https://user-images.githubusercontent.com/12345/67890",
    "https://private-user-images.githubusercontent.com/12345/67891?jwt=token",
  ].join("\n");

  assert.deepEqual(extractPrBodyMedia(body), [
    "https://example.com/a.png",
    "https://example.com/demo.mp4",
    "https://example.com/b.webp",
    "https://example.com/c.webm",
    "https://example.com/d.mp4",
    "https://github.com/user-attachments/assets/11111111-2222-3333-4444-555555555555",
    "https://user-images.githubusercontent.com/12345/67890",
    "https://private-user-images.githubusercontent.com/12345/67891?jwt=token",
  ]);
});

test("extracts full, collapsed, and shortcut reference-style Markdown images", () => {
  const body = [
    "![first][Screenshot One]",
    "![Second Shot][]",
    "![third-shot]",
    "",
    "[screenshot one]: https://example.com/ref-one.png \"first\"",
    "[second shot]: <https://example.com/ref-two.webp>",
    "[third-shot]: https://example.com/ref-three.svg",
  ].join("\n");

  assert.deepEqual(extractPrBodyMedia(body), [
    "https://example.com/ref-one.png",
    "https://example.com/ref-two.webp",
    "https://example.com/ref-three.svg",
  ]);
});

test("reference-style image removal is protected even when its definition remains", () => {
  const oldBody = [
    "![shot][asset]",
    "",
    "[asset]: https://example.com/reference.png",
  ].join("\n");
  const newBody = [
    "Image removed but definition accidentally left behind.",
    "",
    "[asset]: https://example.com/reference.png",
  ].join("\n");

  assert.deepEqual(diffPrBodyMedia(oldBody, newBody).unapprovedMissing, [
    "https://example.com/reference.png",
  ]);
});

test("deduplicates media identities and ignores ordinary links", () => {
  const body = [
    "![shot](https://example.com/a.png)",
    '<img src="https://example.com/a.png">',
    "[docs](https://example.com/docs)",
  ].join("\n");

  assert.deepEqual(extractPrBodyMedia(body), ["https://example.com/a.png"]);
});

test("recognizes legacy GitHub uploads even when linked without a file extension", () => {
  const body = [
    "[old screenshot](https://user-images.githubusercontent.com/12345/67890)",
    "[private screenshot](https://private-user-images.githubusercontent.com/12345/67891?jwt=token)",
  ].join("\n");

  assert.deepEqual(extractPrBodyMedia(body), [
    "https://user-images.githubusercontent.com/12345/67890",
    "https://private-user-images.githubusercontent.com/12345/67891?jwt=token",
  ]);
});

test("allows media to be reordered while text changes", () => {
  const oldBody = "before\n![a](https://example.com/a.png)\n![b](https://example.com/b.png)";
  const newBody = "after\n![b](https://example.com/b.png)\n![a](https://example.com/a.png)";

  assert.deepEqual(diffPrBodyMedia(oldBody, newBody), {
    missing: [],
    approvedMissing: [],
    unapprovedMissing: [],
  });
});

test("reports accidental media removal", () => {
  const result = diffPrBodyMedia(
    "![a](https://example.com/a.png)\n![b](https://example.com/b.png)",
    "![a](https://example.com/a.png)",
  );

  assert.deepEqual(result.missing, ["https://example.com/b.png"]);
  assert.deepEqual(result.approvedMissing, []);
  assert.deepEqual(result.unapprovedMissing, ["https://example.com/b.png"]);
});

test("permits only exact approved removals", () => {
  const oldBody = "![a](https://example.com/a.png)\n![b](https://example.com/b.png)";
  const newBody = "text only";
  const result = diffPrBodyMedia(oldBody, newBody, ["https://example.com/a.png"]);

  assert.deepEqual(result.approvedMissing, ["https://example.com/a.png"]);
  assert.deepEqual(result.unapprovedMissing, ["https://example.com/b.png"]);
});
