import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FEATURE_CONTRACT, pickFallbackLabels, toFeatureInput } from '../model/nameFeatures'
import type { FeatureInput } from '../model/nameFeatures'
import type { AnalyzedName, AiAnalysisResult } from '../types'

type WorkerRequest = {
  id: number
  type: 'infer'
  payload: { result: FeatureInput }
}

type WorkerResponse = {
  id: number
  type: 'result' | 'error'
  payload: { labels?: string[]; message?: string }
}

const MODEL_VERSION = 'onnx-v1'
const WORKER_TIMEOUT_MS = 10_000
const OLLAMA_TIMEOUT_MS = 45_000
const NATIVE_TIMEOUT_MS = 60_000
const NATIVE_CANCEL_GRACE_MS = 5_000
const NATIVE_CANCEL_COMMAND_TIMEOUT_MS = 2_000
const RETRY_DELAY_MS = 250
const MAX_ATTEMPTS = 2
const OLLAMA_URLS = [
  'http://localhost:11434/api/generate',
  'http://127.0.0.1:11434/api/generate',
] as const
const isTauri = () => '__TAURI_INTERNALS__' in window

let workerPromise: Promise<Worker | null> | null = null
let currentWorker: Worker | null = null
let nextRequestId = 1
const pendingByWorker = new Map<Worker, Set<() => void>>()
let workerQueue = Promise.resolve()

export type InferenceOptions = {
  signal?: AbortSignal
}

function abortError() {
  return new DOMException('Inference cancelled', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      finish()
      reject(abortError())
    }
    const timeout = setTimeout(() => {
      finish()
      resolve()
    }, ms)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      cleanup()
      reject(abortError())
    }
    const cleanup = () => signal.removeEventListener('abort', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(
      value => { cleanup(); resolve(value) },
      error => { cleanup(); reject(error) },
    )
  })
}

function invalidateWorker(worker: Worker) {
  worker.terminate()
  if (currentWorker === worker) {
    currentWorker = null
    workerPromise = null
  }
  const pending = pendingByWorker.get(worker)
  pendingByWorker.delete(worker)
  pending?.forEach(fail => fail())
}

async function withWorkerSlot<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const previous = workerQueue
  let settled = false
  let resolveResult!: (value: T) => void
  let rejectResult!: (reason: unknown) => void
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  const cancel = () => {
    if (settled) return
    settled = true
    rejectResult(abortError())
  }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()

  const queued = previous.then(async () => {
    if (signal?.aborted) {
      signal.removeEventListener('abort', cancel)
      return
    }
    try {
      const value = await operation()
      if (!settled) {
        settled = true
        resolveResult(value)
      }
    } catch (error) {
      if (!settled) {
        settled = true
        rejectResult(error)
      }
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  })
  workerQueue = queued.then(() => undefined, () => undefined)
  return result
}

function buildFeatureText(result: AnalyzedName) {
  const charParts = result.chars.map(char => {
    const entry = char.entry
    const cultural = char.cultural
    const meanings = entry?.definition_cn ?? '未收录'
    const culture = cultural
      ? [cultural.element ? `${cultural.element}行` : '', cultural.connotation ?? '', cultural.genderBias ?? '']
          .filter(Boolean)
          .join('；')
      : '无文化标签'

    return `${char.char}(${char.role})：${meanings}｜${culture}`
  })

  return [
    `姓名：${result.original}`,
    ...charParts,
    `模型版本：${MODEL_VERSION}`,
  ].join('\n')
}

function cleanDefinition(text: string): string {
  if (!text) return ''
  let cleaned = text.replace(/.*(?:俗字|义同|见“|亦作).*[。？?！!\s]?/g, '')
  cleaned = cleaned.replace(/^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s\d]+/, '')
  const match = cleaned.match(/^[^。；;！？!]+/)
  return match ? match[0].trim() : cleaned.slice(0, 15).trim()
}

function buildSummary(labels: string[], result: AnalyzedName, source: 'model' | 'fallback') {
  if (labels.length === 0) return '名字整体音韵和谐，展现出一种平衡而中正的气质。'
  const givenChars = result.chars.filter(c => c.role === 'given')
  const meaningfulChar = givenChars.find(c => {
    const def = c.entry?.definition_cn || ''
    return def && !def.includes('俗字') && !def.includes('姓')
  }) || givenChars[0]
  const coreMeaning = cleanDefinition(meaningfulChar?.entry?.definition_cn || '')
  const openings = [`“${result.original}”这个名字`, `在“${result.original}”中`, `纵观“${result.original}”的选字` ]
  const opening = openings[Math.floor(result.original.length % openings.length)]
  let culturalLogic = ''
  const element = givenChars.find(c => c.cultural?.element)?.cultural?.element
  const litRef = givenChars.find(c => c.cultural?.literaryRef)?.cultural?.literaryRef
  if (litRef) { culturalLogic = `通过典故的化用，为名字注入了深厚的古典底蕴` }
  else if (element) { culturalLogic = `借助“${element}”行的意象，构建了平衡的五行能量` }
  else { culturalLogic = `通过精准的选字组合` }
  const descriptors: Record<(typeof FEATURE_CONTRACT.labels)[number], string> = {
    '书卷': '书卷润墨的雅致',
    '宏伟': '开阔宏大的格局',
    '豪迈': '昂扬洒脱的气魄',
    '恬静': '温婉沉静的质感',
    '典雅': '古朴隽永的余韵',
    '新颖': '清新别致的时代感',
    '灵动': '轻盈鲜活的灵气',
    '坚毅': '坚定刚劲的力量',
    '自然': '山水相生的清润',
    '深邃': '含蓄悠远的意境',
  }
  const primaryLabel = labels[0] || '书卷'
  const vibe = descriptors[primaryLabel] || '独特'
  let summary = `${opening}${culturalLogic}，${labels.length > 1 ? '在此基础上进一步' : ''}生发出${vibe}。`
  if (coreMeaning && coreMeaning.length > 1) { summary += ` 尤其是“${meaningfulChar?.char}”字所代表的“${coreMeaning}”之意，起到了点睛之笔的作用。` }
  return source === 'fallback' ? `${summary} (本地解析)` : summary
}

function createWorker(): Promise<Worker | null> {
  try { return Promise.resolve(new Worker(new URL('../workers/localInference.worker.ts', import.meta.url), { type: 'module' })) }
  catch { return Promise.resolve(null) }
}

async function getWorker(): Promise<Worker | null> {
  if (!workerPromise) {
    const creation = createWorker()
      .then(async (worker) => {
        if (!worker) return null
        try {
          const ok = await testWorkerConnection(worker)
          if (!ok) {
            worker.terminate()
            return null
          }
          currentWorker = worker
          return worker
        } catch {
          worker.terminate()
          return null
        }
      })
      .catch(() => null)
    workerPromise = creation
    const worker = await creation
    if (!worker && workerPromise === creation) workerPromise = null
    return worker
  }
  return workerPromise
}

function testWorkerConnection(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    const id = -1;
    const finish = (connected: boolean) => {
      clearTimeout(timeout)
      worker.removeEventListener('message', handle)
      worker.removeEventListener('error', handleError)
      resolve(connected)
    }
    const timeout = setTimeout(() => finish(false), WORKER_TIMEOUT_MS)
    const handle = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      if (res && res.id === id) {
        finish(res.payload?.labels?.[0] === 'pong')
      }
    }
    const handleError = () => finish(false)
    worker.addEventListener('message', handle)
    worker.addEventListener('error', handleError)
    try {
      worker.postMessage({ type: 'ping', id })
    } catch {
      finish(false)
    }
  })
}

async function inferWorkerAttempt(result: AnalyzedName, signal?: AbortSignal): Promise<string[] | null> {
  return withWorkerSlot(async () => {
    throwIfAborted(signal)
    const worker = await raceWithSignal(getWorker(), signal)
    if (!worker) return null
    throwIfAborted(signal)

    return new Promise((resolve) => {
      const id = nextRequestId++;
      let settled = false
      const pending = pendingByWorker.get(worker) ?? new Set<() => void>()
      pendingByWorker.set(worker, pending)
      const cleanup = () => {
        clearTimeout(timeout)
        worker.removeEventListener('message', handleMessage)
        worker.removeEventListener('error', handleError)
        signal?.removeEventListener('abort', handleAbort)
        pending.delete(settleFailure)
        if (pending.size === 0) pendingByWorker.delete(worker)
      }
      const settle = (labels: string[] | null) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(labels)
      }
      const handleMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) return
        settle(event.data.type === 'result' ? event.data.payload.labels ?? null : null)
      }
      const settleFailure = () => settle(null)
      const handleAbort = () => invalidateWorker(worker)
      const failWorker = () => invalidateWorker(worker)
      const handleError = () => failWorker()
      const timeout = setTimeout(failWorker, WORKER_TIMEOUT_MS)
      pending.add(settleFailure)
      worker.addEventListener('message', handleMessage)
      worker.addEventListener('error', handleError)
      signal?.addEventListener('abort', handleAbort, { once: true })
      try {
        worker.postMessage({ id, type: 'infer', payload: { result: toFeatureInput(result) } } satisfies WorkerRequest)
      } catch {
        failWorker()
      }
    })
  }, signal)
}

async function inferViaWorker(result: AnalyzedName, signal?: AbortSignal): Promise<string[] | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const labels = await inferWorkerAttempt(result, signal)
    throwIfAborted(signal)
    if (labels?.length) return labels
    if (attempt + 1 < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS, signal)
  }
  return null
}

function requestController(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort(signal?.reason)
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Inference timed out', 'TimeoutError'))
  }, timeoutMs)
  signal?.addEventListener('abort', cancel, { once: true })
  return {
    controller,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
    },
  }
}

async function cancelNativeSummary(requestId: string) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (cancelled: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(cancelled)
    }
    const timeout = setTimeout(() => finish(false), NATIVE_CANCEL_COMMAND_TIMEOUT_MS)
    void invoke('cancel_internal_summary', { requestId }).then(
      () => finish(true),
      () => finish(false),
    )
  })
}

type NativeSummaryResult = {
  summary: string | null
  timedOut: boolean
}

async function checkNativeModelForInference(signal?: AbortSignal): Promise<{ available: boolean; timedOut: boolean }> {
  throwIfAborted(signal)
  const modelCheck = requestController(WORKER_TIMEOUT_MS, signal)
  const aborted = new Promise<never>((_, reject) => {
    modelCheck.controller.signal.addEventListener('abort', () => reject(modelCheck.controller.signal.reason ?? abortError()), { once: true })
  })
  try {
    return {
      available: await Promise.race([invoke<boolean>('check_model_exists'), aborted]),
      timedOut: false,
    }
  } catch {
    throwIfAborted(signal)
    return { available: false, timedOut: modelCheck.didTimeout() }
  } finally {
    modelCheck.cleanup()
  }
}

async function fetchNativeSummary(result: AnalyzedName, signal?: AbortSignal): Promise<NativeSummaryResult> {
  if (!isTauri()) return { summary: null, timedOut: false }
  const model = await checkNativeModelForInference(signal)
  if (!model.available) return { summary: null, timedOut: model.timedOut }

  const context = buildFeatureText(result)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal)
    const requestId = crypto.randomUUID()
    const request = requestController(NATIVE_TIMEOUT_MS, signal)
    const generation = invoke<string>('generate_internal_summary', {
      requestId,
      name: result.original,
      context,
    })
    const aborted = new Promise<never>((_, reject) => {
      request.controller.signal.addEventListener('abort', () => reject(request.controller.signal.reason ?? abortError()), { once: true })
    })
    try {
      return { summary: await Promise.race([generation, aborted]), timedOut: false }
    } catch {
      if (request.controller.signal.aborted) {
        if (signal?.aborted) {
          void cancelNativeSummary(requestId)
          throw abortError()
        }
        const cancellationSent = await cancelNativeSummary(requestId)
        if (!cancellationSent) return { summary: null, timedOut: true }
        const stopped = await Promise.race([
          generation.then(() => true, () => true),
          delay(NATIVE_CANCEL_GRACE_MS).then(() => false),
        ])
        if (!stopped) return { summary: null, timedOut: true }
        if (attempt + 1 < MAX_ATTEMPTS) {
          await delay(RETRY_DELAY_MS, signal)
          continue
        }
        return { summary: null, timedOut: request.didTimeout() }
      }
      if (attempt + 1 >= MAX_ATTEMPTS) return { summary: null, timedOut: false }
      await delay(RETRY_DELAY_MS, signal)
    } finally {
      request.cleanup()
    }
  }
  return { summary: null, timedOut: false }
}

async function fetchOllamaSummary(labels: string[], result: AnalyzedName, signal?: AbortSignal): Promise<string | null> {
  const prompt = `你是一个精通中国传统文化、文学和取名艺术的专家。名字是“${result.original}”。基调为${labels.join('、')}。结合具体字义生成一段100字左右的文雅姓名意境分析。只输出分析内容。`;

  for (const [index, url] of OLLAMA_URLS.entries()) {
    throwIfAborted(signal)
    const request = requestController(OLLAMA_TIMEOUT_MS, signal)
    try {
      const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'name-expert',
            prompt,
            stream: false,
            options: { temperature: 0.7 },
          }),
          signal: request.controller.signal,
      })
      if (!response.ok) continue
      const data = await response.json() as { response?: string }
      const summary = data.response?.trim()
      if (summary) return summary
    } catch {
      throwIfAborted(signal)
    } finally {
      request.cleanup()
    }
    if (index + 1 < OLLAMA_URLS.length) await delay(RETRY_DELAY_MS, signal)
  }
  return null
}

export async function checkNativeModel() {
  if (!isTauri()) return true;
  return await invoke<boolean>('check_model_exists');
}

export async function checkSystemMemory() {
  if (!isTauri()) return 16; // Web 模式默认返回足够
  return await invoke<number>('check_memory');
}

export async function startModelDownload(onProgress: (p: { progress: number; total_size: number; downloaded: number }) => void) {
  const unlisten = await listen<{ progress: number; total_size: number; downloaded: number }>('download-progress', (event) => {
    onProgress(event.payload);
  });
  try {
    return await invoke<string>('download_model');
  } finally {
    unlisten();
  }
}

export async function runLocalAiAnalysis(result: AnalyzedName, options: InferenceOptions = {}): Promise<AiAnalysisResult> {
  const { signal } = options
  throwIfAborted(signal)
  let labels: string[] = [];
  let source: 'model' | 'fallback' = 'fallback';
  try {
    const modelLabels = await inferViaWorker(result, signal)
    if (modelLabels?.length && modelLabels[0] !== 'pong') { labels = modelLabels; source = 'model'; }
  } catch {}
  throwIfAborted(signal)
  if (labels.length === 0) { labels = pickFallbackLabels(buildFeatureText(result)); source = 'fallback'; }
  const native = await fetchNativeSummary(result, signal).catch((error): NativeSummaryResult => {
    throwIfAborted(signal)
    console.error('[Inference] Tauri native LLM failed:', error)
    return { summary: null, timedOut: false }
  })
  const ollamaSummary = native.summary ?? (native.timedOut ? null : await fetchOllamaSummary(labels, result, signal))
  throwIfAborted(signal)
  return {
    labels,
    summary: ollamaSummary || buildSummary(labels, result, source),
    loadedFromCache: source === 'model',
    source: source,
  }
}
