import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm'
import emotionUrl from './emotion.onnx?url'
import questionsUrl from './questions.onnx?url'
import vocabulary from './vocabulary.json'
import { hashWord, labels, storyFeatures, type InferenceRequest, type InferenceResponse, type ReadingPrediction } from './inference'

env.wasm.numThreads = 1
env.wasm.proxy = false

const options: InferenceSession.SessionOptions = { executionProviders: ['wasm'] }
let emotion: Promise<InferenceSession> | undefined
let decoder: Promise<InferenceSession> | undefined
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
const introduction = /\b(?:named|called|introduced(?: herself as| himself as)?|name was|never met)\s+([A-Z][a-z]{1,24})\b/
const subject = /(?:^|[“"])([A-Z][a-z]{1,24})\s+(?:[a-z]+ed|could|had|was|felt|heard|found|took|saw|knew|ran|said)\b/
const pronoun = /^(?:We|He|She|It|They|There|That|This|When|Everyone|Someone|Nobody|Nothing|Something|Who)$/i

function personIn(sentence: string) {
  const person = introduction.exec(sentence)?.[1] ?? subject.exec(sentence)?.[1]
  return person && !pronoun.test(person) ? person : undefined
}

function probabilities(values: Float32Array) {
  // Soften the confidence of the small model on out-of-distribution prose.
  const top = Math.max(...values)
  const weights = Array.from(values, value => Math.exp((value - top) / 1.4))
  const sum = weights.reduce((a, b) => a + b, 0)
  return weights.map(value => value / sum)
}

async function question(label: number, stamp: string, person?: string) {
  const { tokens, maxSteps } = vocabulary
  const style = person && labels[label] === 'character' ? 0 : person ? hashWord(stamp) % 3 : 1 + hashWord(stamp) % 2
  const labelCount = labels.length
  const previousOffset = labelCount + 3 + maxSteps
  const model = await (decoder ??= InferenceSession.create(questionsUrl, options))
  const input = new Float32Array(previousOffset + tokens.length)
  input[label] = input[labelCount + style] = 1
  const words: string[] = []
  let previous = 0
  for (let step = 0; step < maxSteps; step++) {
    input[labelCount + 3 + step] = input[previousOffset + previous] = 1
    const { logits } = await model.run({ input: new Tensor('float32', input, [1, input.length]) })
    input[labelCount + 3 + step] = input[previousOffset + previous] = 0
    const data = logits.data as Float32Array
    previous = 1
    for (let i = 2; i < tokens.length; i++) if (data[i] > data[previous]) previous = i
    if (previous === 1) break
    words.push(tokens[previous] === '@person' ? person ?? '' : tokens[previous])
  }
  const line = words.join(' ').replace(/ ([?'])/g, '$1')
  if (!line || words.includes('') || !line.endsWith('?') || line.length > 140) return
  return line[0].toUpperCase() + line.slice(1)
}

async function infer({ text, previous, questions }: InferenceRequest): Promise<ReadingPrediction | undefined> {
  const sentences = Array.from(segmenter.segment(text.slice(0, 9600)), item => item.segment.trim())
    .filter(value => value.split(/\s+/).length >= 4).slice(0, 12)
  if (!sentences.length || !/[a-z]{3,}/i.test(text)) return
  const passages = [text, ...sentences]
  const width = vocabulary.features
  const input = new Float32Array(width * passages.length)
  passages.forEach((value, index) => storyFeatures(value, input.subarray(index * width, (index + 1) * width)))
  const model = await (emotion ??= InferenceSession.create(emotionUrl, options))
  const { logits } = await model.run({ input: new Tensor('float32', input, [passages.length, width]) })
  const output = logits.data as Float32Array
  const scores = probabilities(output.subarray(0, labels.length))
  const best = scores.indexOf(Math.max(...scores))
  const result: ReadingPrediction = { mood: labels[best], confidence: scores[best], scores }
  let strongest = .59
  for (const [i, sentence] of sentences.entries()) {
    const probs = probabilities(output.subarray((i + 1) * labels.length, (i + 2) * labels.length))
    const label = probs.indexOf(Math.max(...probs))
    const mood = labels[label]
    const person = personIn(sentence)
    if (mood === 'quiet' || probs[label] <= strongest) continue
    if (mood === 'character' && (!person || previous?.includes(person))) continue
    strongest = probs[label]
    const stamp = sentence.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 180)
    result.moment = { mood, stamp, person }
  }
  if (questions && result.moment) {
    result.moment.question = await question(labels.indexOf(result.moment.mood), result.moment.stamp, result.moment.person)
  }
  return result
}

let queue = Promise.resolve()
self.addEventListener('message', (event: MessageEvent<InferenceRequest>) => {
  const { id } = event.data
  queue = queue.then(() => infer(event.data)).then(
    result => self.postMessage({ id, result } satisfies InferenceResponse),
    () => self.postMessage({ id } satisfies InferenceResponse),
  )
})
