# DUPLO geometry onboarding

This change registers **87084 (2×3)** in the existing shared PARTS registry. It does not infer Rebrickable identity from equal numbers. Official Mapping, known source part/color relations, six supported LDraw colors, complete dependencies and explicit game-subset confirmation still apply. No network or model requests were made while implementing this change.

## Local extraction (user-run, not run by Codex)

From Test Audio, run:

`node scripts/inspect-brick-geometry.mjs 87084`

For the curved part, use `node scripts/inspect-brick-geometry.mjs 98223`. An optional second argument selects an existing LDraw directory. The tool only reads files and prints JSON. It does not register parts, write caches or call Rebrickable/Gemini. Use shell redirection yourself if you want to retain the report.

The existing dependency walker now has an opt-in extraction mode. Three.js Matrix4 composes each type-1 transform, including Moved To and alias rotations; repeated subpart instances are traversed independently. Bounds come from transformed type-3/4 vertices, not names. The report contains original-entry LDU coordinates (+Y down), full-mesh bounds including studs, primitive origins/matrices, unmodified inline LDCad SNAP records and SHA-256 source bindings. Primitive matrices use Three.js column-major array order. Reflection/winding does not affect vertex bounds. Lines/conditional lines are not solid faces. Resource/path/cycle/instance limits still fail closed.

Extraction is NOT a solid-mesh collision solver or snapping interpreter. It does not automatically discover external LDCad shadow libraries, approve sockets, calculate clutch forces, or register geometry. Stud7 observations identify modeled stud primitives; they do not certify physical engagement. Full-mesh bounds are neither body bounds nor connector grids. Partial extraction on failure is diagnostic only (available=false).

## Source review for 87084

- parts/87084.dat outer box5: origin (0,48,0), scale (60,-48,40); body x=±60,z=±40,y=0..48.
- One stug7-2x2 at x=20 and two stud7 at x=-40,z=±20. Thus six top interfaces: x=-40,0,40 and z=±20, at original y=0; vertical scale 2.75 gives 11 LDU stud height.
- The inner inverted box (56,-44,36), two stud8 tubes at x=±20 and perimeter ribs support the same nominal full-bottom rectangular contract used by the existing ordinary bricks. This is source review, not measured manufacturing clearance or physical certification.
- rectangularGeometry(3,2,48) supplies the existing conservative body box, six bottom sockets and six top studs. Viewer uses Rx(PI) then y=48 translation of the ORIGINAL entry, and the same world yaw as Assembly. No alias is stripped.
- Five inspected source files are hash-bound in the geometry record. All recursive resources must still exist. The binding covers the reviewed files, not a physical certification or a hash of every transitive primitive.

The Mapping candidate diagnostic retains current sourceFiles; geometry.sourceFiles and evidence are automatically retained by the existing Review and Design geometrySnapshot. A bound-file mismatch excludes that candidate; zero/multiple eligible official candidates still fail. No new artifact format or legacy read path is introduced.

## 98223 remains unsupported

98223.dat redirects to 98223b.dat with matrix [0,0,1;0,1,0;-1,0,0]. 98223b references s/98223s01.dat with its inverse. These cancel for the subpart but not for all direct curved faces. The subpart has one stug7-2x2, hence four modeled top studs, not eight. Its source explicitly says reinforcing ribs are not modeled. Tubes and curved faces alone do not establish an audited bottom socket layout or safe curved collision decomposition. Neither 98223 nor 98223b is registered. Keep it in saved inventory, exclude it explicitly from the game subset. Do not approximate its curved top with a full brick merely to pass validation.

## Registering the next ordinary part

1. Inspect the official Mapping and local extraction report; keep original candidate identity and transforms.
2. Review actual top primitives, underside, body envelope and entry orientation. Only a full standard rectangular interface aligned to the supported upright coordinates may use rectangularGeometry.
3. Add ONE reviewedRectangularPart data entry to catalog.ts: ID, dimensions, evidence and reviewed source hashes. No independent Prompt/Schema/Validator/Viewer whitelist edits are needed. This remains a developer-reviewed data change and rebuild, not automatic runtime registration.
4. Add regression cases for odd dimensions/half-grid mating, rotation, collisions, unsupported heights, prefix buildability and inventory limits. Complex shapes need an explicitly reviewed profile; unknown evidence cannot be promoted by a filename.

## Manual acceptance

- Run the newly added test cases and normal build yourself; none were run during this task.
- Open Brick Test; 87084 should appear as 2×3. Inspect top/underside and rotate 0/90/180/270. A lower 3437 at (0,0,0) and upper 87084 at x=0.5,z=0,layer=1 should mate at four points. Centering both at x=0 should fail; same-layer overlap and a suspended upper brick should fail.
- Recheck the existing three-part example and placements. Their profile data and coordinate conventions were not changed.
- Save an actual catalog-valid 87084/color inventory, mixed with ordinary bricks and 98223. Request a NEW Game Review. Confirm that the official API actually maps the source to 87084, recursive dependencies pass, the color is supported, and 98223 is explicitly excluded. This API mapping was not verified in this task; the available local part-87084 cache only contains an image URL.
- Select quantities and confirm the subset. Generate only when you deliberately choose to call the model. Inspect input inventory, selected profile in the prompt, independent Validator/prefix reports, geometrySnapshot/source evidence and final Viewer. No artifact should consume excluded parts or exceed selected quantities.

Remaining limits: nominal conservative boxes, upright planar interfaces, half-stud horizontal grid, no stress/stability/friction simulation, no automatic underside or curved collision reconstruction, unchanged color and game-size limits. No browser/render/build/real API or physical assembly verification has been performed.
