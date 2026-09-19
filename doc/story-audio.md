# Story Mode audio

Run `npm run dev`, open `/story-voice-test-audio/#/generate`, choose
**Mode → Story Mode**, paste one complete existing Story JSON object, choose
Gemini or Fish Audio, and click Generate Audio. No change to the source Story is
made. A story collection array should be reduced to the one complete Story object
you want to generate (e.g. the supplied `rhino-doctor` object).

## Output

```
generated/
  test-audio/                       # ordinary Test Audio: unchanged
  story-audio/
    rhino-doctor/
      manifest.json
      rhino-doctor__section-1__item-1.mp3
      rhino-doctor__section-1__item-2.mp3
      ...                          # 8 narration clips for the supplied Story
    index-gap-demo/                 # real Fish API smoke-test output
      manifest.json
      index-gap-demo__section-1__item-1.mp3
      index-gap-demo__section-1__item-3.mp3
  metadata.json                    # shared history
```

Filename: `<story.id>__<section.id>__item-<original index + 1>.mp3`.
IDs are used unchanged; unsafe path characters are rejected rather than renamed.
Only `type: "narration"` is synthesized. The parser enumerates the original items
array and uses its index before skipping sounds or other non-TTS items. It does
not derive numbering from the filtered list or `audio.asset_id`.

The original Story object is submitted with each selected section/item to the
existing `/api/test-tts` route; the server independently validates the selection
and reads its text. Gemini/Fish calls are shared with Test Audio. The UI generates
sequentially and stops on error, preserving successful clips and their manifest
entries. Each successful save updates the manifest.

Re-generating the same Story/Section/Item overwrites the stable filename and
updates its manifest and history entry (including provider/voice/model), with no
versions. Previously generated items not selected again are retained; there is
no migration or cleanup of old flattened audio.

## Actual manifest from the Fish smoke test

```json
{
  "story_id": "index-gap-demo",
  "assets": [
    {
      "section_id": "section-1",
      "item_index": 1,
      "text": "森林里传来一个声音。",
      "filename": "index-gap-demo__section-1__item-1.mp3",
      "provider": "fish",
      "voice": "fish-41822ceaa450",
      "model": "s2.1-pro-free"
    },
    {
      "section_id": "section-1",
      "item_index": 3,
      "text": "原来是一只小猫！",
      "filename": "index-gap-demo__section-1__item-3.mp3",
      "provider": "fish",
      "voice": "fish-41822ceaa450",
      "model": "s2.1-pro-free"
    }
  ]
}
```

History rows record `story_id`, `section_id`, `item_index` and `url` pointing to
`/generated/story-audio/<story-id>/<filename>`. The existing Play button prefers
this URL; ordinary and legacy records still use `/generated/test-audio/<filename>`.

## Verification

- `npm run build`: passed (includes TypeScript check).
- `npm test`: 171 passed, 0 failed.
- Real Fish API generation from `test/fixtures/story-audio/index-gap-demo.json`:
  only item 1 and item 3 files created, manifest indices `[1, 3]`, both MP3s fully
  decoded with FFmpeg, history has both rows and audio URLs return HTTP 200.
- Real ordinary Gemini request returned HTTP 201, stayed in `generated/test-audio/`,
  had no Story fields, and its Play URL returned HTTP 200.
- Story generation left the entire `generated/test-audio/` file list unchanged.
- Requesting sound item 2 directly returned HTTP 400 before any TTS call.
- Supplied rhino-doctor Story parsed to 8 narration items without changing source.
- Browser clicking/listening was not automated; use Audio → Play for manual review.
