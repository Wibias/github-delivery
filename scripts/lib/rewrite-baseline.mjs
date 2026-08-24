function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

export function rewriteBaselineRef(remote, branch) {
  const remoteName = String(required(remote, "remote"));
  const branchName = String(required(branch, "branch"));
  return `refs/github-delivery/rewrite-baseline/${remoteName}/${branchName}`;
}

export function readRewriteBaseline(runner, remote, branch) {
  const ref = rewriteBaselineRef(remote, branch);
  const result = runner("git", ["rev-parse", "--verify", ref], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result?.status == null || result.signal || result.status !== 0) return null;
  const sha = String(result.stdout || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) {
    throw new Error("original_local_tip_baseline_invalid");
  }
  return sha;
}

export function absentOidFor(sha) {
  return "0".repeat(String(sha).length);
}

export function createRewriteBaselineCommand(remote, branch, originalLocalTip) {
  const sha = String(required(originalLocalTip, "original_local_tip")).toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("original_local_tip_invalid");
  return ["git", "update-ref", rewriteBaselineRef(remote, branch), sha, absentOidFor(sha)];
}

export function consumeRewriteBaselineCommand(remote, branch) {
  return ["git", "update-ref", "-d", rewriteBaselineRef(remote, branch)];
}
