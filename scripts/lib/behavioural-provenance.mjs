import { createPublicKey, verify as verifySignature } from "node:crypto";

import { canonicalJson } from "./authority-scope.mjs";

export const LOCAL_BEHAVIOURAL_PROVENANCE = "github-delivery/behavioural-transcript";
export const ATTESTED_BEHAVIOURAL_PROVENANCE = "github-delivery/behavioural-transcript-attestation";

export function behaviouralAttestationPayload(run, transcriptsSha256) {
  return canonicalJson({
    schemaVersion: 1,
    kind: ATTESTED_BEHAVIOURAL_PROVENANCE,
    variant: String(run?.variant || ""),
    model: String(run?.model || ""),
    host: String(run?.host || ""),
    skillVersion: run?.skillVersion ?? null,
    transcriptsSha256: String(transcriptsSha256 || ""),
  });
}

export function attachAttestedTranscriptProvenance(
  run,
  transcriptsSha256,
  { signature, keyId = null } = {},
) {
  if (typeof signature !== "string" || !signature.trim()) {
    throw new TypeError("behavioural_attestation_signature_required");
  }
  return {
    ...run,
    provenance: {
      kind: ATTESTED_BEHAVIOURAL_PROVENANCE,
      transcriptsSha256,
      signature,
      ...(keyId ? { keyId: String(keyId) } : {}),
    },
  };
}

function verifiedKey(value) {
  try {
    return createPublicKey(value);
  } catch {
    throw new TypeError("behavioural_attestation_public_key_invalid");
  }
}

export function behaviouralProvenanceStatus(
  run,
  expectedTranscriptsSha256,
  { attestationPublicKey = null } = {},
) {
  const provenance = run?.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw new TypeError("behavioural run provenance required");
  }
  if (provenance.transcriptsSha256 !== expectedTranscriptsSha256) {
    throw new TypeError("behavioural_transcript_hash_mismatch");
  }

  if (provenance.kind === LOCAL_BEHAVIOURAL_PROVENANCE) {
    return {
      kind: provenance.kind,
      transcriptsSha256: expectedTranscriptsSha256,
      trusted: false,
      reason: "unattested_behavioural_transcript",
      keyId: null,
    };
  }

  if (provenance.kind !== ATTESTED_BEHAVIOURAL_PROVENANCE) {
    throw new TypeError("behavioural run provenance required");
  }
  if (typeof provenance.signature !== "string" || !provenance.signature.trim()) {
    throw new TypeError("behavioural_attestation_signature_required");
  }
  if (!attestationPublicKey) {
    return {
      kind: provenance.kind,
      transcriptsSha256: expectedTranscriptsSha256,
      trusted: false,
      reason: "behavioural_attestation_public_key_missing",
      keyId: provenance.keyId ?? null,
    };
  }

  let signature;
  try {
    signature = Buffer.from(provenance.signature, "base64");
  } catch {
    throw new TypeError("behavioural_attestation_signature_invalid");
  }
  if (!signature.length) throw new TypeError("behavioural_attestation_signature_invalid");
  const ok = verifySignature(
    "sha256",
    Buffer.from(behaviouralAttestationPayload(run, expectedTranscriptsSha256), "utf8"),
    verifiedKey(attestationPublicKey),
    signature,
  );
  if (!ok) throw new TypeError("behavioural_attestation_invalid");

  return {
    kind: provenance.kind,
    transcriptsSha256: expectedTranscriptsSha256,
    trusted: true,
    reason: null,
    keyId: provenance.keyId ?? null,
  };
}
