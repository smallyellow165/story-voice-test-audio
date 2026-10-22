# DUPLO Assembly V2 — reviewed part geometry

## Scope and evidence

This is an upgrade of the existing shared assembly.ts, not a second game engine.
No commands, builds, tests, services or model calls were run during implementation.

Read locally:
- parts/3437.dat + parts/s/3437s01.dat: 80×80×48 LDU nominal body, stug7-2x2.
- parts/3011.dat + parts/s/3011s01.dat: 160×80×48 body, two transformed stug7-2x2 groups.
- parts/2300.dat: 240×80×48 body, twelve explicit stud7 placements.
- p/stud7.dat: outer radius 12, height 4; the existing bricks scale Y by 2.75 → 11 LDU.
- The female mating clearance is the existing nominal standard DUPLO interface contract,
  not a measured clutch tolerance extracted from triangles. Profiles are source-reviewed, not physical certification.

LDraw supplies geometric primitives and transformed subfile references:
https://www.ldraw.org/article/218
Additional snapping information is a separate extension/shadow-library concern:
https://wiki.ldraw.org/wiki/Part_Snapping_Language_Extension
No usable shadow library was established in the inspected resource directories.
Do not infer absence across the entire machine; no full-machine scan was performed.

## Shared representation

src/brick-test/part-geometry.ts defines PartGeometry and the ordinary rectangular-family factory.
catalog.ts registers evidence-backed data profiles; Assembly contains no part-number branches.

- bodySizeLdu: nominal body dimensions, distinct from mesh extent and connector layout.
- outerBoundsLdu: null until separately measured; never substituted with body dimensions.
- collision: conservative union of local AABBs, plus upper stud envelopes.
- top/bottom: separate explicit connector arrays (position, direction, interface type, radius/depth).
- rotations and upright placement: only declared quarter turns.
- ldraw transform: Rx(PI) then profile translation, followed by instance yaw/translation.
- status/evidence/unknown: reviewed capability provenance and unresolved properties.

rectangularGeometry is ONLY a data-entry helper for an already reviewed full-interface
ordinary DUPLO brick. It must not be called on arbitrary name-derived dimensions.
Sparse interfaces can be supplied explicitly; curved bodies require reviewed conservative
volumes and interfaces before registration. Unknown profiles are rejected.

Coordinates retain the original stored meanings: x,z are 40 LDU pitches; layer is bottom
height / 48 LDU, not an index assuming every brick is one layer tall.
V2 permits half-pitch centres (odd footprint sizes) and integer-LDU elevations.
Existing integral placements remain unchanged. Half-grid placement does not imply a valid
connection: actual transformed interfaces still have to coincide.

## Shared assembly algorithm

createAssemblyRules binds profile data to the same dimensions, connectors, footprint,
validateAssembly, validatePlacement and connectionCandidates implementation.
The application uses the catalog profiles; tests can exercise abstract profiles without
adding fictitious parts to Catalog or the production registry.

Collision: positive 3D intersection of conservative body boxes; touching faces alone do not
collide or connect. Top stud envelopes cannot enter a body without a matching socket of
adequate radius/depth; stud/stud interference is also rejected. These are conservative boxes,
not exact mesh boolean operations or deformable contact simulation.
Connection: matching interface type, opposing vertical directions, coincident world position.
Support: actual lower top elevation versus actual upper bottom elevation, not layer + 1.
The whole assembly must be connected and every elevated part supported.
Design validation additionally retains the minimum support fraction, prefix checks and
inventory quantity checks. The legacy footprint API now returns bottom interface cells for
support-count consumers; it is never used as collision occupancy.

Viewer continues using Three.js LDrawLoader, including every alias, Moved To and nested
transform. The profile supplies the entry-to-bottom local transform and variable height.
The existing batch-placement UI now increments by the selected profile height.

## 98223

parts/98223.dat references 98223b.dat using matrix [0,0,1, 0,1,0, -1,0,0].
98223b.dat has another transformed reference to s/98223s01.dat.
That subfile contains stug7-2x2 and explicitly says reinforcing ribs are not modelled.
It is not safe to infer eight upper studs from its 2×4 body description, or treat its curved
shell as a rectangular solid. No capability profile was fabricated for it.

Existing model inspection now reports entry reference matrices and detected !LDCAD SNAP_
metadata locations with interpreted=false. This is evidence, not a snapping parser and not
proof of physical compatibility. Mapping keeps the official candidate IDs; no alias ID rewrite.
98223 remains unavailable for generation, with a missing reviewed geometry/connectivity reason.

## Generator and artifact integration

Mapping calls geometrySupport in addition to the existing official Mapping and recursive
resource checks. Candidate capability evidence appears in the existing raw Mapping details.
Generator receives the confirmed Inventory subset and the exact selected geometry profiles;
coordinates use NUMBER schema fields, then strict shared grid/interface checks.
Review-to-generation compares the reviewed profile with the current profile.
Artifacts/attempts store geometrySnapshot. Loading an artifact checks it against current
profiles before validating its design. Design Hash and inventory-subset evidence remain.
Old Review/Artifact records lacking this geometry evidence are not silently migrated; use a
new Review and a user-triggered generation for this version.
No V4/Pipecat state transitions changed. The shared browser game only receives the new
coordinate predicate through its existing Validator dependency.

## Registering another ordinary brick

1. Confirm official RB→LDraw candidates and local dependency availability through existing Review.
2. Inspect the referenced entry including transformations: body size/origin, stud coordinates,
   underside interfaces and height. Obtain trusted connector metadata or manually review it.
3. For an ordinary full-interface brick, add a data profile using rectangularGeometry; no new
   assembly branch. For other interfaces, provide reviewed explicit geometry or leave unsupported.
4. Add tests for yaw, collisions, mating, unsupported placements, support fraction and viewer alignment.
5. Rebuild the shared module and verify a newly generated artifact before enabling actual use.

No additional real part numbers were registered in this change: the engine is more general,
but automated physical-attribute extraction and a general connector metadata importer are not implemented.

## User verification

- /brick-test: original three parts, staircase, all four yaw angles, stacking, overhang,
  duplicate occupancy, floating parts, deleting a support and candidate placement.
- Confirm rendered bottoms touch the floor/support plane as before; no inverted or offset models.
- A half-pitch-shifted upper standard brick must fail mating/collision; it must not be accepted
  merely because its body boxes touch.
- Run test/brick-geometry-v2.test.mjs yourself for abstract 4×3, 1×1, 72/16 LDU height,
  sparse interfaces, unmatched stud penetration, rotations and unknown capabilities.
  These fixtures never enter normal Inventory or model requests.
- Run existing assembly/generator/mapping tests and build:module yourself.
- Create a new real mixed-inventory Review: standard bricks eligible, 98223 excluded with reason.
- Explicitly choose quantities and trigger generation once. Check geometrySnapshot, actual
  inventory input, Validator usage/support/prefix results, and the original V4 launch entry.

Not verified: compilation, test results, browser rendering, latency, actual generated output,
physical clutch fit/stability. Curves, sideways building, hinges, arbitrary rotations, exact
triangle collision and automatic LDraw connector inference remain out of scope.


## New part onboarding

87084 (2×3) is now registered via source-reviewed rectangular geometry. See [geometry onboarding](brick-geometry-onboarding.md) for source evidence, local extraction, restrictions and manual acceptance. The three original profiles remain unchanged; 98223 remains unsupported.
