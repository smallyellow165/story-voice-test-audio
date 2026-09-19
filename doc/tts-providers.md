# TTS Test Audio: Gemini / Fish Audio

Run `npm run dev` in the project directory, then open
`http://localhost:5173/story-voice-test-audio/#/generate` (or the configured PORT).
Restart the server after changing `.env` or server code. `vite preview` alone does
not provide the generation API.

- Gemini: choose Provider → Gemini, select any existing voice, enter a script,
  and Generate Audio. Google Cloud ADC and the existing
  `gemini-3.1-flash-tts-preview` / `cmn-CN` / MP3 request are unchanged.
- Fish Audio: choose Provider → Fish Audio and generate the same script.
  The server reads `FISH_AUDIO_API_KEY` and `FISH_AUDIO_MODEL_ID`; the latter is
  passed as `reference_id`, not as the inference model. No browser-side keys.
- Play the result with the inline player, or open Audio and click Play in the
  shared history. Voice filters include the provider. Old records without a
  provider remain Gemini records.

## SDK and storage

Official npm `fish-audio@0.1.0`, via `FishAudioClient({ apiKey })` and
`textToSpeech.convert({ text, reference_id, format: 'mp3' }, 's2.1-pro-free', options)`.
The installed SDK's second parameter goes directly into the HTTP `model` header,
though its backend type union predates this model. The SDK response is collected
fully before writing the MP3; no realtime or WebSocket integration is used.
Automatic retries are disabled and requests have a 120-second deadline.

Source: https://github.com/fishaudio/fish-audio-typescript
Free model: https://fish.audio/developers/

Both providers use the existing `generated/test-audio/` files and serialized
`generated/metadata.json` appends, now recording `provider`, `voice`, and `model`.
Fish voice identity is `fish-` plus a stable SHA-256 fingerprint of the configured
reference (12 hex characters), so changing references creates distinguishable
history without putting the raw reference ID in filenames or logs.

API errors retain the provider status and message with key/reference redaction.
There is no fallback to a paid model, Gemini, or mock audio.

## Verification (2026-09-19)

- Build including TypeScript check passed; all 167 tests passed.
- Both generated MP3 files passed full FFmpeg decoding.
- Real Fish `s2.1-pro-free` request: HTTP 201, 71,052-byte MP3, 4.44075 seconds;
  real Gemini Achernar request: HTTP 201, 23,136-byte MP3, 5.784 seconds.
- Both records appeared in history and both audio URLs returned HTTP 200.
- Unsupported provider and empty Fish text returned HTTP 400.
- No Fish authentication, free-model permission, or quota error occurred in the
  single real request. This does not establish larger quotas or concurrency limits.
- Browser automation was unavailable; manually check provider switching and Play.
  Test clips are retained in the local history for listening.
