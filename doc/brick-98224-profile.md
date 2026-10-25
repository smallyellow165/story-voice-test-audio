# 98224 reviewed upright geometry

The shared Catalog registers the official **98224 entry**, not an ordinary 3011 replacement. No historical Mapping, Analysis, Review or plan is rewritten.

## Coordinates and size

`98224.dat` maps `98224b` via `(x,y,z)=(z_b,y_b,-x_b)`. The existing Viewer applies Rx(PI), then `(0,48,0)`, producing assembly-local `(z_b,48-y_b,x_b)`. Thus the long axis is X, with curved undersides at both X ends. The profile retains this original entry so the renderer composes the MOVED rotation exactly once.

Body bounds: X ±80, Z ±40, Y 0..48 LDU. Body size 160×48×80 LDU, or 64×19.2×32 mm under the project's nominal 0.4 mm/LDU conversion. Including the top studs, height is 59 LDU / 23.6 mm. The body is one standard 48-LDU brick high; this does not change Catalog name-derived height fields.

## Approved interfaces

Top: eight contact cells `(x,y,z)=({-60,-20,20,60},48,±20)`, upward, stud height 11 LDU and radius 12 LDU. Evidence: central `stug7-2x2` with Y scale 2.75 plus four end `stud7a` instances. End primitives start at LDraw y=25 and scale Y=9; their y=-4 rim maps to y=-11, the same height as the central studs. Their longer shafts extend into the body, leaving the nominal 11-LDU exposed mating height.

Bottom: four nominal socket contact cells `(±20,0,±20)`, downward, insertion depth 11 LDU. Evidence: central inverted box5 (inner ±36, depth44), central stud8 tube, eight perimeter ribs at ±34, and the user's confirmation of underside DUPLO mating. Four cells do **not** mean four tube primitives: the central tube and perimeter walls cooperate to retain four studs, as in the existing ordinary DUPLO profile contract.

Both sides use the shared nominal DUPLO connector model. No friction, load or clutch-force claim is made.

The end subpart also models recessed structures near `98224b z=±60`, including stud7a and partial cylinder surfaces. The end studs provide the additional top interfaces, but their interior recesses are **not certified bottom mating interfaces** in this profile. They must not be treated as eight bottom sockets merely because the outer footprint is 2×4. Off-plane/recessed mating remains unsupported.

## Collision scope

The central 80×48×80 body uses the existing cavity-aware mating contract. Both curved ends use mirrored conservative box strips from the official outer facet vertices: the rounded ellipse segment `(33+47*cos(theta),48-48.3*sin(theta))` joins the explicit side vertices through `(40,0)`. Each strip extends downward to its lowest endpoint with a 0.001-LDU outward allowance, and upward to Y=48.

This is the same conservative-box mechanism used for 2302, not a new collision engine or full rectangular substitute. It preserves substantial clearance beneath the raised ends. Close facet clearances and insertion into unapproved recesses may still be rejected conservatively. The original official mesh remains the rendered shape.

## Verification

Run `node --test test/brick-98224-geometry.test.mjs` and `node experiments/geometry-execution/check-98224.mjs`.

The latter writes a new timestamped directory under `output/98224-profile/` and prints an existing Geometry Viewer URL. It creates a deterministic three-part assembly: red 3437 below, white 98224 in the middle, red 3437 above. There is no reference photograph, model invocation or production Analysis involved. Strict Geometry Execution must return one candidate with two connections and eight mating points. Source bindings are checked before enrichment.

The test covers both entry transforms, official mesh bounds and top primitive locations, four yaw choices, central upper/lower connections, invalid yaw/grid offsets, absent end studs, real collisions and curved clearance, strict execution and profile-drift rejection. Existing saved profiles stay immutable; missing profiles can be enriched through the existing recorded enrichment mechanism. `98224b` is not separately registered because the authoritative export Mapping chooses `98224`; an import ID is not silently normalized to a different entry coordinate frame.
