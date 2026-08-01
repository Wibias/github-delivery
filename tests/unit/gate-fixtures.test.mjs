import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ownersForPath,
  parseCodeowners,
} from "../../scripts/lib/codeowners.mjs";
import { collectPaginated } from "../../scripts/lib/github-pagination.mjs";
import {
  findUnaddressedFeedback,
  normalizeFeedback,
} from "../../scripts/lib/watch-feedback.mjs";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/gates.json", import.meta.url), "utf8"),
);

test("CODEOWNERS fixtures use last-match-wins including ownerless rules", () => {
  const rules = parseCodeowners(fixtures.codeowners.text);
  for (const fixture of fixtures.codeowners.cases) {
    assert.deepEqual(
      ownersForPath(rules, fixture.path)?.owners ?? null,
      fixture.owners,
    );
  }
});

test("trusted feedback fixtures include short human comments", () => {
  const feedback = fixtures.feedback.items.map((item) =>
    normalizeFeedback(item, "issue_comment"),
  );
  const unresolved = findUnaddressedFeedback({
    feedback,
    commits: [],
    myLogin: fixtures.feedback.myLogin,
  });
  assert.deepEqual(
    unresolved.map((item) => item.key),
    fixtures.feedback.expectedKeys,
  );
});

test("pagination fixtures collect every page", () => {
  const result = collectPaginated({
    pageSize: 2,
    fetchPage(page) {
      return { ok: true, body: fixtures.pagination.pages[page - 1] || [] };
    },
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.rows, fixtures.pagination.expected);
});

test("pagination refuses partial results after the safety limit", () => {
  const result = collectPaginated({
    pageSize: 1,
    maxPages: 2,
    fetchPage(page) {
      return { ok: true, body: [page] };
    },
  });
  assert.equal(result.complete, false);
  assert.match(result.error, /safety limit/);
});
