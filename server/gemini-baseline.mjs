/**
 * Adapted from Google LLC's Apache-2.0 licensed image example (Copyright 2025).
 * https://github.com/google-gemini/api-examples/blob/51979868abf95d062a149b62af92854b2a24f005/javascript/text_generation.js
 * License: ../public/gemini-baseline/APACHE-2.0.txt
 * Changes: local sample path, explicit Developer API, HTTP result/error handling,
 * request timeout, and deletion of this run's uploaded file.
 */
import { createUserContent, createPartFromUri } from '@google/genai'
import { createGeminiClient } from './gemini-client.mjs'
import { fileURLToPath } from 'node:url'

export const baselineModel = 'gemini-3.7-flash'
export const baselinePrompt = 'Tell me about this instrument'
const samplePath = fileURLToPath(new URL('../public/gemini-baseline/organ.jpg', import.meta.url))

export function baselineStatus() {
  return { model: baselineModel, prompt: baselinePrompt, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()) }
}

export async function runGeminiBaseline() {
  const ai = createGeminiClient()
  let organ
  let stage = 'image upload'
  const started = performance.now()
  try {
    organ = await ai.files.upload({ file: samplePath })
    stage = 'generateContent'
    const response = await ai.models.generateContent({
      model: baselineModel,
      contents: [
        createUserContent([
          baselinePrompt,
          createPartFromUri(organ.uri, organ.mimeType),
        ]),
      ],
    })
    const text = response.text || ''
    const finishReason = response.candidates?.[0]?.finishReason
    return {
      ok: Boolean(text.trim()) && finishReason === 'STOP',
      model: baselineModel,
      modelVersion: response.modelVersion,
      prompt: baselinePrompt,
      text,
      finishReason,
      blockReason: response.promptFeedback?.blockReason,
      usageMetadata: response.usageMetadata,
      elapsedMs: Math.round(performance.now() - started),
    }
  } catch (error) {
    // SDK errors can contain request credentials. Return only stage + numeric status.
    const status = Number.isInteger(error?.status) ? error.status : undefined
    throw Object.assign(new Error(`Gemini Developer API ${stage} failed${status ? ` (HTTP ${status})` : ''}. Check GEMINI_API_KEY, model access, quota and network connectivity.`), { statusCode: 502 })
  } finally {
    if (organ?.name) {
      await ai.files.delete({ name: organ.name, config: { httpOptions: { timeout: 10000 } } }).catch(() => {
        console.warn('Gemini baseline: uploaded sample cleanup failed; Files API expiry will remove it.')
      })
    }
  }
}
