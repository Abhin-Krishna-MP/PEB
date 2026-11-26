import type { BeatKind, SpiritMood } from '../lib/companion'

export const labels = ['quiet', 'humor', 'joy', 'enthusiasm', 'fear', 'sadness', 'suspense', 'surprise', 'relief', 'character'] as const
export type Emotion = typeof labels[number]
export const expressions: Record<Exclude<Emotion, 'quiet'>, [SpiritMood, BeatKind]> = {
  humor: ['happy', 'humor'], joy: ['encouraging', 'warmth'], enthusiasm: ['happy', 'warmth'],
  fear: ['surprised', 'danger'], sadness: ['focused', 'grief'], suspense: ['curious', 'unease'],
  surprise: ['surprised', 'surprise'], relief: ['encouraging', 'relief'], character: ['curious', 'doubt'],
}

export const primaryModel = 'onnx-community/gemma-3-270m-it-ONNX'
export const fallbackModel = 'HuggingFaceTB/SmolLM2-360M-Instruct'
export const quantization = 'q4'
export const cacheName = 'transformers-cache'
export type ModelId = typeof primaryModel | typeof fallbackModel
export type ModelDownload = { model: ModelId; files: string[]; bytes?: number }
export type ReadingPrediction = { mood: Emotion; question?: string }
export type ReadingExcerpt = { text: string; previous: readonly string[]; previousMood?: Emotion; recent: readonly string[] }
export type InferenceRequest =
  | { id: number; type: 'download' }
  | { id: number; type: 'predict'; model: ModelId; excerpt: ReadingExcerpt }
  | { id: number; type: 'cancel' }
export type InferenceResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'started' }
  | { id: number; type: 'downloaded'; download: ModelDownload }
  | { id: number; type: 'result'; result?: ReadingPrediction }
  | { id: number; type: 'error'; error: string; unavailable?: boolean }

export function modelFile(url: string, model: ModelId) {
  const address = new URL(url)
  return address.origin === 'https://huggingface.co' && address.pathname.startsWith('/' + model + '/resolve/')
}

// Quotes and escapes must be tracked so a brace inside a question is harmless.
export function parseReadingPrediction(raw: string, recent: readonly string[] = []): ReadingPrediction | undefined {
  const start = raw.indexOf('{')
  if (start < 0) return
  let depth = 0
  let quoted = false
  let escape = false
  for (let index = start; index < raw.length; index++) {
    const char = raw[index]
    if (escape) { escape = false; continue }
    if (quoted && char === '\\') { escape = true; continue }
    if (char === '"') quoted = !quoted
    if (quoted) continue
    if (char === '{') depth++
    if (char !== '}' || --depth !== 0) continue
    try {
      const { mood, question } = JSON.parse(raw.slice(start, index + 1)) as Record<string, unknown>
      if (!labels.includes(mood as Emotion)) return
      const result: ReadingPrediction = { mood: mood as Emotion }
      if (mood === 'quiet' || typeof question !== 'string') return result
      const line = question.trim().replace(/\s+/g, ' ')
      const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
      if (line.length <= 140 && /[\p{L}\p{N}].*\?$/u.test(line) && !recent.slice(0, 6).some(value => normalized(value) === normalized(line))) {
        result.question = line
      }
      return result
    } catch { return }
  }
}
