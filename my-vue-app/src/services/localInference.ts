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
const NATIVE_MAX_ATTEMPTS = 3
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

export function buildGroundedSummaryPrompt(labels: string[], result: AnalyzedName): string {
  const factualDraft = buildLocalSummary(labels, result, 'model')
  const given = result.chars.filter(char => char.role === 'given')
  const givenCharacters = given.map(char => char.char)
  const unknownCharacters = given.filter(char => !namingMeaning(char)).map(char => char.char)
  const repeatedCharacter = givenCharacters.length > 1 && new Set(givenCharacters).size === 1

  return [
    '任务：只润色基础文稿，不介绍人物，不增加事实。',
    `基础文稿：${factualDraft}`,
    `开头必须保留为：在“${result.original}”中，`,
    '必须完整保留文稿中的姓名字义和已注明出处的文化联想。',
    '禁止出现字号、人称、出生、籍贯、人物身份、生平、作品、成就、书香门第、国家、民族、政治、军事、仕途或命运推断。',
    '不得在姓名后重复名字用字或添加“字”“号”等身份句式。',
    repeatedCharacter ? `“${givenCharacters[0]}”是叠字名，只解释一次字义，不要把同一个“${givenCharacters[0]}”字解释两次。` : '',
    unknownCharacters.length > 0 ? `“${unknownCharacters.join('”“')}”没有可核实的名字字义，不得解释、联想或补写这些字的含义；只能保留基础文稿中的结构描述。` : '',
    '不得输出拼音、英文、标题、列表或解释过程。',
    '输出80至130个汉字，只输出润色后的正文。',
  ].filter(Boolean).join('\n')
}

export function groundedSummaryRejection(summary: string, result?: AnalyzedName): string | null {
  const text = summary.trim()
  const length = [...text].length
  if (/[A-Za-z]/.test(text)) return '包含英文或拼音。'
  if (/(?:输出要求|事实边界|只允许使用|结合具体字义生成|角色=|字义=|读音[：=])/u.test(text)) return '复述了提示词或生成要求。'
  if (/(?:国家|民族|政治|军事|官场|仕途|事业有成|功成名就|成就非凡)/u.test(text)) return '加入了基础文稿之外的身份、成就或命运推断。'
  const claimsBiography = /(?:^|[，。；\s])(?:字|号)(?:为|曰|叫作|名为)?[\u3400-\u9fff]{1,4}(?=[，。；\s]|$)|(?:著名|杰出|历史上).{0,12}(?:人物|名将|将军|政治家|军事家|诗人|文人|官员)/u.test(text)
  if (claimsBiography) return '虚构了字号或人物身份。'
  if (result) {
    const givenName = result.chars.filter(char => char.role === 'given').map(char => char.char).join('')
    if (
      text.startsWith(`${result.original}字`)
      || text.startsWith(`${result.original}号`)
      || text.startsWith(`${result.original}，${givenName}字`)
      || text.startsWith(`${result.original},${givenName}字`)
      || (text.startsWith(`${result.original}（`) && /）[，,\s]*(?:字|号)/u.test(text))
    ) return '把名字用字误写成了人物字号。'
    const unknownCharacters = result.chars
      .filter(char => char.role === 'given' && !namingMeaning(char))
      .map(char => char.char)
    for (const char of unknownCharacters) {
      const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(?:“${escaped}”|${escaped}字)(?:有|取|表示|象征|寓意|带有|体现)`, 'u').test(text)) {
        return `为缺少可靠释义的“${char}”补写了含义。`
      }
    }
  }
  if (
    /(?:生于|出生于|祖籍|籍贯)|(?:北京|上海|天津|重庆|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|河北|山西|辽宁|吉林|黑龙江|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|台湾)[\u3400-\u9fff]{0,6}人|(?:书法|文学|政治|军事).{0,10}(?:造诣|成就)|(?:他的|她的)(?:作品|诗歌|生平|事迹)|(?:被誉为|被尊为|人称|号称)/u.test(text)
  ) return '虚构了出生信息、生平、作品或成就。'
  if (/(?:春秋|战国|秦汉|汉唐|秦朝|汉朝|汉代|唐朝|唐代|宋朝|宋代|明朝|明代|清朝|清代|古代|先贤|史载|相传)/u.test(text)) return '加入了基础文稿之外的历史背景。'
  if (length < 80) return `长度不足：当前${length}个字符，至少需要80个字符。`
  if (length > 130) return `长度超出：当前${length}个字符，最多允许130个字符。`
  return null
}

export function isGroundedSummary(summary: string, result?: AnalyzedName): boolean {
  return groundedSummaryRejection(summary, result) === null
}

function cleanDefinition(text: string): string {
  if (!text) return ''
  if (/(?:会意|形声|象形|指事|小篆字形)/u.test(text)) return ''
  const unusable = /(?:会意|形声|象形|指事|转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从[\u3400-\u9fff]|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  const segments = text
    .replace(/^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s\d]+/, '')
    .split(/[。；;！？!，,]/)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/g, '').trim())
    .filter(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
  return segments[0]?.slice(0, 24) ?? ''
}

function namingMeaning(char: AnalyzedName['chars'][number]): string {
  const gloss = char.cultural?.localGloss?.trim()
  if (gloss) return gloss
  const connotation = char.cultural?.connotation?.split(/[；。]/)[0]?.trim()
  return connotation || cleanDefinition(char.entry?.definition_cn || '')
}

export function buildLocalSummary(labels: string[], result: AnalyzedName, source: 'model' | 'fallback') {
  if (labels.length === 0) return '名字整体音韵和谐，展现出一种平衡而中正的气质。'
  const givenChars = result.chars.filter(c => c.role === 'given')
  const meanings = givenChars
    .map(char => ({ char: char.char, meaning: namingMeaning(char) }))
    .filter(item => item.meaning)
    .filter((item, index, items) => items.findIndex(candidate => candidate.char === item.char) === index)
    .slice(0, 2)
  const repeatedCharacter = givenChars.length > 1 && new Set(givenChars.map(char => char.char)).size === 1
  const literaryRef = givenChars
    .map(char => char.cultural?.literaryRef?.trim())
    .find(reference => reference && /《[^》]+》/.test(reference))
  const meaningText = meanings.length > 1
    ? `“${meanings[0]!.char}”有${meanings[0]!.meaning}之意，“${meanings[1]!.char}”则带有${meanings[1]!.meaning}的意味。`
    : meanings.length === 1
      ? `“${meanings[0]!.char}”有${meanings[0]!.meaning}之意。`
      : ''
  const singleCharacterText = givenChars.length === 1 && meanings.length === 1
    ? literaryRef
      ? '单字为名使语意集中，姓与名衔接简洁，读来利落而有分寸。'
      : `单字为名使语意集中，姓与名衔接简洁，读来利落有力；这个字既清楚表达${meanings[0]!.meaning}，也让名字保有不张扬的分寸。`
    : ''
  const repeatedCharacterText = repeatedCharacter && meanings.length === 1
    ? literaryRef
      ? `叠字为名强化了“${meanings[0]!.char}”的意象，也形成轻盈节奏，读来亲切而有辨识度。`
      : `叠字为名使“${meanings[0]!.char}”的意象得到自然强化，也形成轻盈舒展的节奏；重复而不繁复，读来亲切柔和，并让名字更有辨识度。`
    : ''
  const repeatedUnknownText = repeatedCharacter && meanings.length === 0
    ? '叠字结构形成清晰而轻盈的节奏，重复用字增强了姓名的连贯感与辨识度；当前资料没有可直接采用的字义，因此不补充未经核实的含义。'
    : ''
  const incompleteMeaningText = !repeatedCharacter && meanings.length < givenChars.length
    ? meanings.length === 0
      ? '当前资料没有可直接采用的名字字义，因此只作保守的结构描述，不补充未经核实的含义。'
      : '现有资料只覆盖其中一个名字用字，因此不对另一字补充未经核实的含义；已知字义与整体结构衔接自然。'
    : ''
  const pairedMeaningText = meanings.length > 1 && !literaryRef
    ? '两层含义衔接自然，既各自清楚，也共同构成完整连贯而不过度引申的表达。'
    : ''
  const descriptors: Record<(typeof FEATURE_CONTRACT.labels)[number], string> = {
    '书卷': '清朗而有书卷气',
    '宏伟': '开阔而有格局',
    '豪迈': '昂扬而不失洒脱',
    '恬静': '温和沉静',
    '典雅': '端正雅致',
    '新颖': '清新而有辨识度',
    '灵动': '轻盈鲜活',
    '坚毅': '坚定有力量',
    '自然': '自然清润',
    '深邃': '含蓄而有余味',
  }
  const vibes = labels.slice(0, 2).map(label => descriptors[label]).filter(Boolean)
  const vibeText = meanings.length > 1 && vibes.length > 1
    ? `名字中的两个用字彼此映照，整体${vibes[0]}，也保留了${vibes[1]}的分寸。`
    : `名字整体${vibes[0] || '平和自然'}${vibes[1] ? `，也保留了${vibes[1]}的分寸` : ''}，读来舒展而协调。`
  const referenceText = literaryRef
    ? `文化联想上，${literaryRef.replace(/^可联想到/u, '可联系').replace(/[。；;]+$/u, '')}，使名字的意涵更有层次。`
    : ''
  const summary = `在“${result.original}”中，${meaningText}${singleCharacterText}${repeatedCharacterText}${repeatedUnknownText}${incompleteMeaningText}${pairedMeaningText}${vibeText}${referenceText}`
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
  failure: 'none' | 'timeout' | 'quality' | 'runtime'
}

function correctiveSummaryPrompt(originalPrompt: string, rejected: string, reason: string): string {
  return [
    originalPrompt,
    `上一次输出未通过检查，具体原因：${reason}`,
    `不合格输出：${rejected.slice(0, 300)}`,
    '不得沿用其中的虚构身份、经历、字号、出生信息、提示复述或生硬的“某字”句式。',
    '重新输出符合原始基础文稿、80至130个汉字的正文。',
  ].join('\n')
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

async function fetchNativeSummary(labels: string[], result: AnalyzedName, signal?: AbortSignal): Promise<NativeSummaryResult> {
  if (!isTauri()) return { summary: null, failure: 'none' }
  const model = await checkNativeModelForInference(signal)
  if (!model.available) return { summary: null, failure: model.timedOut ? 'timeout' : 'none' }

  const originalContext = buildGroundedSummaryPrompt(labels, result)
  let context = originalContext
  for (let attempt = 0; attempt < NATIVE_MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal)
    const requestId = crypto.randomUUID()
    const request = requestController(NATIVE_TIMEOUT_MS, signal)
    const generation = invoke<string>('generate_internal_summary', {
      requestId,
      name: result.original,
      context,
      attempt: attempt + 1,
    })
    const aborted = new Promise<never>((_, reject) => {
      request.controller.signal.addEventListener('abort', () => reject(request.controller.signal.reason ?? abortError()), { once: true })
    })
    try {
      const summary = await Promise.race([generation, aborted])
      const rejection = groundedSummaryRejection(summary, result)
      if (!rejection) {
        return { summary, failure: 'none' }
      }
      context = correctiveSummaryPrompt(originalContext, summary, rejection)
      if (attempt + 1 < NATIVE_MAX_ATTEMPTS) {
        await delay(RETRY_DELAY_MS, signal)
        continue
      }
      return { summary: null, failure: 'quality' }
    } catch {
      if (request.controller.signal.aborted) {
        if (signal?.aborted) {
          void cancelNativeSummary(requestId)
          throw abortError()
        }
        const cancellationSent = await cancelNativeSummary(requestId)
        if (!cancellationSent) return { summary: null, failure: 'timeout' }
        const stopped = await Promise.race([
          generation.then(() => true, () => true),
          delay(NATIVE_CANCEL_GRACE_MS).then(() => false),
        ])
        if (!stopped) return { summary: null, failure: 'timeout' }
        if (attempt + 1 < NATIVE_MAX_ATTEMPTS) {
          await delay(RETRY_DELAY_MS, signal)
          continue
        }
        return { summary: null, failure: request.didTimeout() ? 'timeout' : 'runtime' }
      }
      if (attempt + 1 >= NATIVE_MAX_ATTEMPTS) return { summary: null, failure: 'runtime' }
      await delay(RETRY_DELAY_MS, signal)
    } finally {
      request.cleanup()
    }
  }
  return { summary: null, failure: 'runtime' }
}

async function fetchOllamaSummary(labels: string[], result: AnalyzedName, signal?: AbortSignal): Promise<string | null> {
  const prompt = buildGroundedSummaryPrompt(labels, result)

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
      if (summary && isGroundedSummary(summary, result)) return summary
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

export async function getModelDirectory(): Promise<string> {
  return await invoke<string>('get_model_directory')
}

export async function setModelDirectory(directory: string): Promise<string> {
  return await invoke<string>('set_model_directory', { directory })
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

export function formatModelDownloadError(error: unknown): string {
  const detail = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : ''
  return detail
    ? `模型下载失败：${detail}`
    : '模型下载失败，请检查网络设置后重试。'
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
  const native = await fetchNativeSummary(labels, result, signal).catch((error): NativeSummaryResult => {
    throwIfAborted(signal)
    console.error('[Inference] Tauri native LLM failed:', error)
    return { summary: null, failure: 'runtime' }
  })
  let generatedSummary = native.summary
  let summarySource: 'native' | 'ollama' | 'fallback' = native.summary ? 'native' : 'fallback'
  if (native.failure === 'timeout') throw new Error('原生 Qwen 生成超时，请重试。')
  if (native.failure === 'quality') throw new Error('原生 Qwen 输出未通过事实检查，请重新分析。')
  if (native.failure === 'runtime') throw new Error('原生 Qwen 运行失败，请重试。')
  if (!generatedSummary) {
    generatedSummary = await fetchOllamaSummary(labels, result, signal)
    if (generatedSummary) summarySource = 'ollama'
  }
  throwIfAborted(signal)
  return {
    labels,
    summary: generatedSummary || buildLocalSummary(labels, result, source),
    loadedFromCache: source === 'model',
    source: source,
    summarySource,
  }
}
