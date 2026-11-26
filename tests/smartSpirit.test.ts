import { describe, expect, it, vi } from 'vitest'
import { openReadingModel } from '../src/companion/client'
import { parseReadingPrediction, primaryModel, type InferenceRequest, type InferenceResponse } from '../src/companion/inference'

describe('Smart Spirit replies', () => {
  it('reads plain, fenced and prefixed JSON', () => {
    const reply = '{"mood":"suspense","question":"Why did she hide the key?"}'
    for (const output of [reply, '```json\n' + reply + '\n```', 'Result: ' + reply + ' done']) {
      expect(parseReadingPrediction(output)).toEqual({ mood: 'suspense', question: 'Why did she hide the key?' })
    }
  })

  it('handles malformed, quiet, duplicate and invalid replies', () => {
    expect(parseReadingPrediction('{broken}')).toBeUndefined()
    expect(parseReadingPrediction('{"mood":"wrong","question":null}')).toBeUndefined()
    expect(parseReadingPrediction('{"mood":"quiet","question":"Why?"}')).toEqual({ mood: 'quiet' })
    expect(parseReadingPrediction('{"mood":"fear","question":"run now"}')).toEqual({ mood: 'fear' })
    expect(parseReadingPrediction('{"mood":"fear","question":"Why?"}', [' why? '])).toEqual({ mood: 'fear' })
    expect(parseReadingPrediction(JSON.stringify({ mood: 'fear', question: 'w'.repeat(140) + '?' }))).toEqual({ mood: 'fear' })
    expect(parseReadingPrediction('{"mood":"fear","question":"What does {the mark} mean?"}')?.question).toBe('What does {the mark} mean?')
  })

  it('cancels an old page request and ignores its late response', async () => {
    const sent: InferenceRequest[] = []
    const worker = {
      onmessage: (event: { data: InferenceResponse }) => { void event },
      postMessage: (message: InferenceRequest) => sent.push(message),
      terminate: vi.fn(),
    }
    const client = openReadingModel(() => worker as unknown as Worker)
    const controller = new AbortController()
    const sample = { text: 'A scene', previous: [], recent: [] }
    const old = client.predict(primaryModel, sample, controller.signal)
    controller.abort()
    const next = client.predict(primaryModel, sample, new AbortController().signal)
    worker.onmessage({ data: { id: 1, type: 'result', result: { mood: 'fear' } } })
    worker.onmessage({ data: { id: 2, type: 'result', result: { mood: 'joy' } } })
    expect(sent.map(message => message.type)).toEqual(['predict', 'cancel', 'predict'])
    expect((await old).result).toBeUndefined()
    expect((await next).result).toEqual({ mood: 'joy' })
    client.close()
  })

  it('keeps download progress separate from the inference watchdog', async () => {
    const worker = {
      onmessage: (event: { data: InferenceResponse }) => { void event },
      postMessage: vi.fn(),
      terminate: vi.fn(),
    }
    const client = openReadingModel(() => worker as unknown as Worker)
    const progress = vi.fn()
    const task = client.download(progress)
    worker.onmessage({ data: { id: 1, type: 'progress', loaded: 250, total: 1000 } })
    const download = { model: primaryModel, files: ['model'], bytes: 1000 } as const
    worker.onmessage({ data: { id: 1, type: 'downloaded', download: { ...download, files: [...download.files] } } })
    expect(progress).toHaveBeenCalledWith(250, 1000)
    expect(await task).toEqual(download)
    client.close()
  })
})
