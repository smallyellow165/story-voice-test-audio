import { GoogleGenAI } from '@google/genai'

// Shared by the official baseline and ring detection. No ADC or Cloud fallback.
export function createGeminiClient() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw Object.assign(new Error('Set GEMINI_API_KEY in the server .env and restart the server.'), { statusCode: 503 })
  }
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    vertexai: false,
    httpOptions: { timeout: 90000, retryOptions: { attempts: 1 } },
  })
}
