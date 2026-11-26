import type { InferenceRequest, InferenceResponse, ReadingPrediction } from './inference'

export function openReadingModel() {
  let worker: Worker
  try {
    worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' })
  } catch { return }
  let id = 0
  let closed = false
  const pending = new Map<number, (prediction?: ReadingPrediction) => void>()
  function close() {
    if (closed) return
    closed = true
    worker.terminate()
    pending.forEach(resolve => resolve())
    pending.clear()
  }
  worker.onerror = close
  worker.onmessageerror = close
  worker.onmessage = ({ data }: MessageEvent<InferenceResponse>) => pending.get(data.id)?.(data.result)

  return {
    close,
    predict(request: Omit<InferenceRequest, 'id'>) {
      return new Promise<ReadingPrediction | undefined>(resolve => {
        if (closed) { resolve(undefined); return }
        const requestId = ++id
        const finish = (value?: ReadingPrediction) => {
          window.clearTimeout(timeout)
          pending.delete(requestId)
          resolve(value)
        }
        const timeout = window.setTimeout(finish, 4500)
        pending.set(requestId, finish)
        try { worker.postMessage({ ...request, id: requestId }) }
        catch { finish() }
      })
    },
  }
}
