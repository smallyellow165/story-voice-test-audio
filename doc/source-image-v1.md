# Source Image V1

Source Image is the root asset, not a Project or published Artifact. No selected relationship is introduced.

## Canonical storage and identity

Production uses one shared store: `generated/brick-source-images/<64 lowercase hex>.json`.

```json
{
  "schemaVersion": 1,
  "imageId": "sha256:<SHA-256 of original file bytes>",
  "original": {
    "mimeType": "image/png",
    "byteLength": 219353,
    "imageBase64": "<original file bytes encoded as base64>"
  }
}
```

The server validates the original, derives the ID itself, and atomically publishes a complete record without replacing an existing one. Concurrent identical uploads deduplicate. Reads verify schema version, ID, byte count and digest. Existing corrupt assets are rejected, never repaired by upload. Names and timestamps do not define identity. Re-encoded/cropped/otherwise changed bytes are different assets.

Both Reverse Analysis (assembled Parts Explorer) and inventory recognition (loose Parts Explorer) require `originalImage` when creating runs. Each retains its own UUID `id` and records `sourceImageId`. History summaries expose this reference. Guided analysis and local revisions inherit the parent's original evidence and validated reference. Step verification is outside this source-image workflow and keeps its existing contract.

Original per-run evidence, model input, compression metadata and traces remain stored as before. In particular, `image_reference.sha256` still identifies the compressed Analysis input; it is not redefined as the original hash. The canonical image is an asset record, while the per-run original snapshot remains provenance evidence checked against that asset.

`GET /api/brick-source-images/<URL-encoded imageId>` reads the canonical JSON, including the exact original bytes. The Parts Explorer result displays Analysis ID and a Source Image link. No full image-grouped History UI is implemented.

## Existing records: explicit repair required

No migration runs at startup, read, upload, restore or History listing. Missing `sourceImageId`, missing canonical assets and mismatched originals fail validation. Lists report excluded records in warnings, preserving files. Old unmigrated Analysis records cannot be restored/used through the strict Analysis reader until repaired. Existing Review, Spatial, Geometry, Selection and Build Plan files are not rewritten; their IDs remain unchanged.

A future **separately approved, explicitly enumerated** repair operation should:

1. Take a read-only inventory of selected Analysis IDs and byte-level backups/hashes of affected records and dependent provenance. Include reverse/loose store identity; do not search by name/time.
2. Require the exact saved `originalImage` bytes, validate their MIME/signature, calculate SHA-256, and produce a proposed `analysisId → sourceImageId` mapping. Compressed-only records are unresolved, not promoted to originals.
3. Check existing declared original hashes and any preserved Spatial `originalImageSha256` against those same bytes. Any conflict stops repair for that record. No approximate matching.
4. Check whole-record hashes and retry fingerprints before deciding the write set: e.g. Analysis revisions may contain `parentSha256` of the original JSON file. Simply adding a field to the parent changes that hash. An approved repair must account for the complete affected dependency set and audit any explicitly updated integrity references; it must not silently invalidate a descendant, rewrite model output, or pretend a migrated fingerprint was the original request fingerprint.
5. Publish canonical images; add the verified formal reference only to approved Analysis records; retain IDs, original payloads, Review content and all semantic upstream references. Record exact before/after hashes, operation version and evidence in an audit manifest outside runtime code. Abort on concurrent file changes. Never patch unrelated records.
6. Verify every selected lineage and exact original bytes, compare protected files, and document unresolved records. Retain backups for rollback.

This document is a repair plan, not a migration tool. No production records were repaired as part of Source Image V1.

## Verification

Tests use temporary stores and stub providers. The Penguin test reads the actual local source image when available; the synthetic version runs everywhere. No paid calls are made.

```bash
node --experimental-strip-types --test test/brick-source-images.test.mjs
npm run build
```

UI: open Parts Explorer, select the Penguin original, run analysis, record both IDs. Explicitly start a new analysis with the same original (new request, not retry); Analysis IDs must differ and Source Image IDs must match. Follow the link to canonical JSON. Upload a byte-identical renamed copy and a different original to verify identity semantics. These UI analysis actions invoke the configured model normally; they were not run automatically during implementation.

Next: a read-only imageId-based History query/grouping, explicit selected relationships, immutable Review and Build Plan revisions. None requires changing this asset identity or creating a second history store.

## Follow-up

Image-centered History and the separately audited four-run Penguin repair are documented in [image-centered-history-v1.md](image-centered-history-v1.md). The Source Image identity/schema above is unchanged.
