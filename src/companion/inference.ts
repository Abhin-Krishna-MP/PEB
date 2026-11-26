import vocabulary from './vocabulary.json'
import type { BeatKind, SpiritMood } from '../lib/companion'

export type Emotion = 'quiet' | 'humor' | 'joy' | 'enthusiasm' | 'fear' | 'sadness' | 'suspense' | 'surprise' | 'relief' | 'character'
export const labels = vocabulary.labels as Emotion[]
export const expressions: Record<Exclude<Emotion, 'quiet'>, [SpiritMood, BeatKind]> = {
  humor: ['happy', 'humor'], joy: ['encouraging', 'warmth'], enthusiasm: ['happy', 'warmth'],
  fear: ['surprised', 'danger'], sadness: ['focused', 'grief'], suspense: ['curious', 'unease'],
  surprise: ['surprised', 'surprise'], relief: ['encouraging', 'relief'], character: ['curious', 'doubt'],
}
export type ReadingPrediction = {
  mood: Emotion
  confidence: number
  scores: number[]
  moment?: { mood: Exclude<Emotion, 'quiet'>; stamp: string; question?: string; person?: string }
}
export type InferenceRequest = { id: number; text: string; previous?: readonly string[]; questions?: boolean }
export type InferenceResponse = { id: number; result?: ReadingPrediction }

export function hashWord(word: string) {
  let hash = 2166136261
  for (let i = 0; i < word.length; i++) hash = Math.imul(hash ^ word.charCodeAt(i), 16777619)
  return hash >>> 0
}

export function storyFeatures(text: string, vector: Float32Array) {
  const roots = (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []).slice(0, 160).map(word => word.slice(0, 5))
  const counts = new Map<string, number>()
  const bigrams = roots.slice(1).map((word, i) => roots[i] + '/' + word)
  for (const key of [...roots, ...bigrams]) counts.set(key, Math.min(2, (counts.get(key) ?? 0) + 1))
  for (const [key, count] of counts) vector[hashWord(key) % vector.length] += count * (key.includes('/') ? .45 : 1)
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm > 1) for (let i = 0; i < vector.length; i++) vector[i] /= norm
}
