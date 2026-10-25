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

The P parent is 3437 and its reviewed solid profile has four top and four bottom mating cells. Spatial Mapping now accepts a separate **geometry-only** binding through the existing Catalog's structured `print_relationships`: exactly one explicit P parent, a unique official base LD export, a reviewed shared Profile, and available unchanged local resources are required. Missing/ambiguous relationships, ambiguous direct LD mappings, missing color evidence and unreviewed base geometry still fail. No number-prefix matching, recursive parent guessing, new mapping table or fabricated official LD row is used.

For 3437pr0068 the saved input keeps `confirmedPart.part_num=3437pr0068`, RB Black 0, and the full P/base-mapping evidence; `part=3437` selects physical geometry. The original Review remains unchanged. Main and independent Viewers explicitly state that a base-geometry mapping does not render the print. Do not use LD 3437pe2 or 3437pe1 as a substitute: their official headers identify different prints (RB 3437pr0056 and 3437pr0067).

Verification artifacts are in `output/3437pr0068-mapping/`: real penguin 10/10 Mapping and prepare-only request, independent three-brick interface fixture (Geometry Valid, two connections/eight mates), browser screenshots, history hashes, tests and build logs. The penguin still has unreviewed profiles for 11170 and 98223; preparing a request does not claim the full penguin is geometry executable. No LLM call or DB modification was performed. The existing Generator two-identical-parts test fails for 98224 on both HEAD and the changed tree because of a real stud/body collision; its validator was not weakened.

Public corroboration: https://www.bricklink.com/catalogItemIn.asp?P=3437pe2&in=A&ov=Y&srt=0&srtAsc=A&v=1 lists Black and sets 1739-1/2299-1. The user's photographed piece still requires human confirmation against the Type 2 print; catalog correspondence does not prove photo identity.
