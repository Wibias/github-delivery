import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "spdx-2.3.schema.json"), "utf8"),
);
const SYNTHETIC_CREATED = "1980-01-01T00:00:00Z";
const DOCUMENT_ID = "SPDXRef-DOCUMENT";

function fail(code, detail = "") {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function validateJsonSchema(value, schema, path) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    fail("spdx_schema_invalid", path);
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("spdx_schema_type", `${path}:object`);
    }
    for (const key of schema.required || []) {
      if (value[key] === undefined) fail("spdx_schema_required", `${path}.${key}`);
    }
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) continue;
      const property = schema.properties?.[key];
      if (!property) {
        if (schema.additionalProperties === false) fail("spdx_schema_additional", `${path}.${key}`);
        continue;
      }
      validateJsonSchema(value[key], property, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) fail("spdx_schema_type", `${path}:array`);
    if (schema.items) {
      value.forEach((item, index) => validateJsonSchema(item, schema.items, `${path}[${index}]`));
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") fail("spdx_schema_type", `${path}:string`);
    if (schema.enum && !schema.enum.includes(value)) fail("spdx_schema_enum", path);
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") fail("spdx_schema_type", `${path}:boolean`);
    return;
  }
  fail("spdx_schema_unsupported", path);
}

function indexBySpdxId(items = []) {
  const index = new Map();
  for (const item of items) {
    if (!item?.SPDXID) fail("spdx_id_missing");
    if (index.has(item.SPDXID)) fail("spdx_id_duplicate", item.SPDXID);
    index.set(item.SPDXID, item);
  }
  return index;
}

function fileDigest(file, algorithm) {
  const checksum = (file.checksums || []).find((entry) => entry.algorithm === algorithm);
  const value = String(checksum?.checksumValue || "");
  if (algorithm === "SHA1" && !/^[0-9a-f]{40}$/.test(value)) fail("spdx_file_sha1_missing", file.SPDXID);
  if (algorithm === "SHA256" && !/^[0-9a-f]{64}$/.test(value)) fail("spdx_file_sha256_missing", file.SPDXID);
  return value;
}

function boundPackageChecksum(pkg, filesById, relationships) {
  const checksums = pkg.checksums || [];
  if (checksums.length === 0) return;
  const contained = new Map();
  for (const rel of relationships) {
    if (rel.spdxElementId !== pkg.SPDXID || rel.relationshipType !== "CONTAINS") continue;
    const file = filesById.get(rel.relatedSpdxElement);
    if (!file) fail("spdx_contains_unknown", rel.relatedSpdxElement);
    contained.set(file.fileName, file);
  }
  for (const checksum of checksums) {
    const file = contained.get(pkg.packageFileName);
    const match = file?.checksums?.some((entry) => (
      entry.algorithm === checksum.algorithm && entry.checksumValue === checksum.checksumValue
    ));
    if (!match) fail("spdx_package_checksum_unbound", pkg.SPDXID);
  }
}

function assertVerificationCode(pkg, filesById, relationships) {
  if (pkg.filesAnalyzed === false) {
    if (pkg.packageVerificationCode) fail("spdx_package_verification_code_forbidden", pkg.SPDXID);
    return;
  }
  const value = pkg.packageVerificationCode?.packageVerificationCodeValue;
  if (!/^[0-9a-f]{40}$/.test(value || "")) fail("spdx_package_verification_code_missing", pkg.SPDXID);
  const hashes = [];
  for (const rel of relationships) {
    if (rel.spdxElementId !== pkg.SPDXID || rel.relationshipType !== "CONTAINS") continue;
    const file = filesById.get(rel.relatedSpdxElement);
    if (!file) fail("spdx_contains_unknown", rel.relatedSpdxElement);
    hashes.push(fileDigest(file, "SHA1"));
  }
  const expected = createHash("sha1").update(hashes.sort().join(""), "utf8").digest("hex");
  if (expected !== value) fail("spdx_package_verification_code_mismatch", pkg.SPDXID);
}

function assertDocumentDescribes(doc, packagesById, filesById) {
  const described = doc.documentDescribes;
  if (!Array.isArray(described) || described.length === 0) fail("spdx_documentDescribes_missing");
  const relationships = doc.relationships || [];
  for (const id of described) {
    if (!packagesById.has(id) && !filesById.has(id)) fail("spdx_documentDescribes_unknown", id);
    const describes = relationships.some((rel) => (
      rel.spdxElementId === DOCUMENT_ID
      && rel.relationshipType === "DESCRIBES"
      && rel.relatedSpdxElement === id
    ));
    if (!describes) fail("spdx_describes_relationship_missing", id);
  }
}

export function validateSpdx23Document(document) {
  validateJsonSchema(document, SCHEMA, "$");
  if (document.spdxVersion !== "SPDX-2.3") fail("spdx_version_unsupported", document.spdxVersion);
  if (document.creationInfo?.created === SYNTHETIC_CREATED) fail("spdx_created_synthetic");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(document.creationInfo?.created || "")) {
    fail("spdx_created_invalid", document.creationInfo?.created || "");
  }
  const packagesById = indexBySpdxId(document.packages);
  const filesById = indexBySpdxId(document.files);
  const relationships = document.relationships || [];
  assertDocumentDescribes(document, packagesById, filesById);
  for (const pkg of document.packages || []) {
    boundPackageChecksum(pkg, filesById, relationships);
    assertVerificationCode(pkg, filesById, relationships);
  }
  return { valid: true };
}
