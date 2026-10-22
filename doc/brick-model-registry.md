# Brick shared model infrastructure

Model identity, provider, task eligibility and invocation defaults live only in server/brick-model-registry.mjs. Both /api/brick-vision and /api/brick-test/generate obtain their options there; both React pages use src/model-selector.tsx with independent controlled selection. Game Preparation also consumes the same generator options.

The six registered IDs are gemini-3.6-flash, gemini-3.1-pro-preview, gpt-4.1, gpt-6.1-sol, gpt-6-luna and gpt-6-astra. These reuse the existing project IDs/configuration, not a live availability check. Inventory recognition and design allow all six. OpenAI step confirmation remains explicitly unavailable; this preserves the existing task boundary, not a claim about the model's intrinsic capability.

Defaults remain DUPLO_VISION_MODEL → DUPLO_LLM_MODEL → Gemini Flash for Vision, and DUPLO_LLM_MODEL → Gemini Flash for design. Defaults must be registered; unknown IDs are rejected rather than silently added or substituted. No environment files are changed.

server/brick-model-call.mjs routes by registry provider. Gemini uses existing gemini-client.mjs and its SDK. OpenAI uses the single server/openai-responses.mjs transport extracted from Vision, POST https://api.openai.com/v1/responses, OPENAI_API_KEY, store=false and text.format.type=json_object. GPT-6 variants retain existing reasoning.effort=medium; GPT-4.1 has no reasoning override. Gemini retains maxOutputTokens=32768, MEDIUM thinking, 180000 ms timeout and attempts=1. OpenAI retains 180000 ms timeout, one fetch and no redirects/retry/fallback. Keys and authorization headers are not recorded.

Task builders retain their business prompts and schema. Vision adds its actual image; design supplies inventory/description text without an image. OpenAI receives the business contract as text plus an explicit JSON instruction in input, not a Gemini responseSchema request field. JSON mode is not schema enforcement: the existing recognition validation / design inventory, geometry and build-order validation still decide acceptance. Official reference: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses

## Durable trace

Both tasks reuse server/brick-vision-wire.mjs. Actual outgoing HTTP body is persisted before send, and the complete raw response body before SDK parsing or business validation. Records include requested provider/model, actual response model and native usage when returned. Missing usage is not invented.

Vision paths remain:
- /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/generated/brick-vision/<id>.json
- /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/generated/brick-vision/<id>.request.json
- /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/generated/brick-vision/<id>.response.txt

Design paths use the same recorder and file format:
- /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/generated/brick-design-traces/<id>.json
- /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/generated/brick-design-traces/<id>.request.json
- /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/generated/brick-design-traces/<id>.response.txt

Design API diagnostics include tracePath, rawRequestPath and rawResponsePath. Actual error responses are retained too. Network failures without a response set wireStatus=no_response; no response is fabricated. Pre-call validation/configuration failures have no provider response. Failure to capture raw response is explicit, not reported as successful generation. History loading still only reads existing Vision records.

## Manual acceptance (not executed by Codex)

1. After manually loading the updated service, open both pages: options and provider/name/ID labels should match. Each page maintains its own selection.
2. In Vision, explicitly select Gemini or OpenAI, upload a photo, click recognition once. Inspect diagnostics for provider, model, modelVersion, HTTP status, usage and compressed image in raw request. Catalog/review/history behavior should be unchanged; loading history must not call a model.
3. In Design Lab, select the desired model, keep a valid inventory and description, click Generate once. Inspect raw request for the selected ID and correct provider format. Inventory and geometry validation must pass before applying the scene; invalid results remain diagnostics.
4. Repeat only for models you intend to pay to test. Check Pro/GPT-6 parameters in the raw request. Missing keys, unavailable models or rejected parameters must produce explicit failure with no switch/retry.
5. Inspect design trace files for success, provider failure and invalid JSON/design outcomes; response capture precedes parsing/validation. Verify no authentication values appear.

No tests, builds, commands, services or paid model calls were executed for this change. Real model permissions, SDK wire capture, UI rendering and end-to-end provider behavior remain unverified. Regression tests cover shared options, task rejection, request contracts, routing and independent design validation with test-only injected transports.
