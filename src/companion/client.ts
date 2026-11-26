import type { InferenceRequest, InferenceResponse, ModelDownload, ModelId, ReadingExcerpt, ReadingPrediction } from './inference'

type Pending = { message: (event: InferenceResponse) => void; fail: (error: Error) => void }

export function openReadingModel(createWorker = () => new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' })) {
  const worker = createWorker()
  const pending = new Map<number, Pending>()
  let nextId = 0
  let closed = false

  function close() {
    if (closed) return
    closed = true
    worker.terminate()
    pending.forEach(request => request.fail(new Error('The model worker closed.')))
  }

  worker.onerror = close
  worker.onmessageerror = close
  worker.onmessage = ({ data }: MessageEvent<InferenceResponse>) => pending.get(data.id)?.message(data)

  return {
    close,
    download(onProgress: (loaded: number, total: number) => void) {
      return new Promise<ModelDownload>((resolve, reject) => {
        if (closed) { reject(new Error('The model worker closed.')); return }
        const id = ++nextId
        let timer: ReturnType<typeof setTimeout>
        const clear = () => { clearTimeout(timer); pending.delete(id) }
        const fail = (error: Error) => { clear(); reject(error) }
        const watch = () => {
          clearTimeout(timer)
          timer = setTimeout(() => { fail(new Error('Model download timed out. Check the connection and retry.')); close() }, 120_000)
        }
        watch()
        pending.set(id, {
          fail,
          message(event) {
            if (event.type === 'progress') { watch(); onProgress(event.loaded, event.total) }
            if (event.type === 'downloaded') { clear(); resolve(event.download) }
            if (event.type === 'error') fail(new Error(event.error))
          },
        })
        try { worker.postMessage({ id, type: 'download' } satisfies InferenceRequest) }
        catch (error) { fail(error instanceof Error ? error : new Error('Could not start download.')) }
      })
    },
    predict(model: ModelId, excerpt: ReadingExcerpt, signal: AbortSignal) {
      return new Promise<{ result?: ReadingPrediction; unavailable?: boolean; timedOut?: boolean }>(resolve => {
        if (closed || signal.aborted) { resolve({}); return }
        const id = ++nextId
        let timer: ReturnType<typeof setTimeout>
        function finish(result?: ReadingPrediction, unavailable?: boolean, timedOut?: boolean) {
          clearTimeout(timer)
          signal.removeEventListener('abort', cancel)
          pending.delete(id)
          resolve({ result, unavailable, timedOut })
        }
        function cancel() {
          finish()
          if (!closed) {
            try { worker.postMessage({ id, type: 'cancel' } satisfies InferenceRequest) }
            catch { close() }
          }
        }
        function expire() {
          finish(undefined, undefined, true)
          close()
        }
        // Bound the entire request, including model loading and a possible
        // backend retry. A hung backend may never process a cancel message.
        timer = setTimeout(expire, 35_000)
        signal.addEventListener('abort', cancel, { once: true })
        pending.set(id, {
          fail: () => finish(),
          message(event) {
            if (event.type === 'result') finish(event.result)
            if (event.type === 'error') finish(undefined, event.unavailable)
          },
        })
        try { worker.postMessage({ id, type: 'predict', model, excerpt } satisfies InferenceRequest) }
        catch { finish() }
      })
    },
  }
}
