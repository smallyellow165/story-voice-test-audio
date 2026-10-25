# External Catalog identities: investigate before importing

Rebrickable remains the primary identity. Catalog search accepts exact qualified external IDs (`BL:…`, `LD:…`, `BO:…`, `LE:…`) using **only** imported `rb_part_mappings`, combined with the ordinary size/color/print filters. Unqualified text remains RB number/name search. No filename or shared-number inference is used.

## 3437pe2 investigation

Existing local RB records and official downloaded `part_mappings.csv` establish:

- BL `3437pe2` → RB `3437pr0068` (export/import both true).
- RB `3437pr0068` has Black (RB 0), a P relationship to 3437, and appears in both 1739-1 and 2299-1 inventories in Black.
- LD `3437pe2` → RB `3437pr0056`, a **different** print without the white spot. Its official LDraw header confirms RB 3437pr0056 and BL 3437pb016.
- RB `3437pr0049` is another print (white spot and varied color curve inside a black circle); its local known colors are Bright Green, Dark Pink, Red and Yellow, not Black.
- The local Mapping table currently contains only LD rows. The missing BL relation is an import-scope omission, not a missing RB part or Black color.

Search now with `eye`, Size `2x2`, Color `Black`, Print `yes`, Require LDraw off. This returns five candidates including 3437pr0068. Or search its RB number directly. Height remains unknown in Catalog metadata; explicitly specifying a height may exclude it. Do not silently relax that condition.

## User-triggered, one-part official Mapping import

Run from `/home/umi/Documents/pg/xiaozhi/My-Good-GYM` using its Python environment:

```bash
python tools/import_rebrickable_part_mappings.py import --ext-system BL --part-num 3437pr0068 --dry-run
```

Inspect the CSV path/hash and proposed changes. To apply that same explicit scope, the user runs:

```bash
python tools/import_rebrickable_part_mappings.py import --ext-system BL --part-num 3437pr0068 --apply
```

`--part-num` is repeatable, requires each identity to exist in the selected CSV/system, and cannot combine with `--sync`. Other mappings remain untouched. The existing transactional importer and schema are reused; no part/color records or new tables are created. After applying, `BL:3437pe2` searches the RB part through the normal Catalog. This task ran dry-run only (one proposed insert, zero updates/deletes).

## Geometry is a separate capability

The P parent is 3437 and its reviewed solid profile has four top and four bottom mating cells. A printed variant can conceptually reuse that profile without duplicating geometry; its RB printed identity must remain distinct. However 3437pr0068 has no official LD mapping in the current data, and the runtime does not currently support a separately approved base-geometry reference. Strict Spatial Planning Mapping therefore fails explicitly. Do not insert a fabricated official LD mapping, use LD 3437pe2, or claim a faithful printed Viewer result.

A future explicit, audited appearance/geometry binding could render a plain black 3437 with a visible “print not rendered” indication while retaining RB 3437pr0068 as identity. That capability is not introduced here. Physical profile validity alone does not make a missing identity mapping pass.

Public corroboration: https://www.bricklink.com/catalogItemIn.asp?P=3437pe2&in=A&ov=Y&srt=0&srtAsc=A&v=1 lists Black and sets 1739-1/2299-1. The user's photographed piece still requires human confirmation against the Type 2 print; catalog correspondence does not prove photo identity.
