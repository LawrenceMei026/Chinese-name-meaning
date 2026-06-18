import type { AnalyzedName, AiAnalysisResult } from '../types'

type SerializableAnalyzedName = {
  original: string
  chars: Array<{
    char: string
    role: 'surname' | 'given'
    entry: {
      pinyin: string
      tones: string
      definition_cn: string
    } | null
    cultural: {
      element?: string
      elementEmoji?: string
      connotation?: string
      genderBias?: 'masculine' | 'feminine' | 'neutral'
      literaryRef?: string
      localGloss?: string
    } | null
  }>
}

type WorkerRequest = {
  id: number
  type: 'infer'
  payload: { result: SerializableAnalyzedName }
}

type WorkerResponse = {
  id: number
  type: 'result' | 'error'
  payload: { labels?: string[]; message?: string }
}

const MODEL_VERSION = 'onnx-v1'
const DEFAULT_LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']

let workerPromise: Promise<Worker | null> | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, (labels: string[] | null) => void>()

function toSerializableResult(result: AnalyzedName): SerializableAnalyzedName {
  return {
    original: result.original,
    chars: result.chars.map(char => ({
      char: char.char,
      role: char.role,
      entry: char.entry
        ? {
            pinyin: char.entry.pinyin,
            tones: char.entry.tones,
            definition_cn: char.entry.definition_cn,
          }
        : null,
      cultural: char.cultural
        ? {
            element: char.cultural.element,
            elementEmoji: char.cultural.elementEmoji,
            connotation: char.cultural.connotation,
            genderBias: char.cultural.genderBias,
            literaryRef: char.cultural.literaryRef,
            localGloss: char.cultural.localGloss,
          }
        : null,
    })),
  }
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

function pickFallbackLabels(text: string): string[] {
  const labels: string[] = []
  if (/[明华文雅诗书兰慕]/.test(text)) labels.push('文雅')
  if (/[山海江川峰岳远志伟豪强鹏鸿瀚]/.test(text)) labels.push('大气')
  if (/[龙武刚勇阳天雄骏锐锋]/.test(text)) labels.push('阳刚')
  if (/[月雪云雨莲梅兰花秀柔姝婉妍婷嫣娜萱霏霁霜溪汐沐湉]/.test(text)) labels.push('柔和')
  if (/[古春秋竹松桐柏葭菁蘅蕴]/.test(text)) labels.push('古典')
  if (/[新现代睿卓敏颖]/.test(text)) labels.push('现代')
  return labels.length ? [...new Set(labels)].slice(0, 3) : ['中性']
}

function buildSummary(labels: string[], source: 'model' | 'fallback') {
  const lead = labels.slice(0, 2).join('、')
  if (!lead) return '名字整体气质平衡，适合进一步结合字义与声调判断。'
  const base = `名字整体呈现${lead}的气质，结合字义来看，和其文化意涵较为一致。`
  return source === 'fallback' ? `${base} 当前使用的是本地回退结果。` : base
}

function getFallbackResult(result: AnalyzedName): AiAnalysisResult {
  const labels = pickFallbackLabels(buildFeatureText(result))
  return {
    labels,
    summary: buildSummary(labels, 'fallback'),
    loadedFromCache: false,
    source: 'fallback',
  }
}

function createWorker(): Promise<Worker | null> {
  try {
    return Promise.resolve(new Worker(new URL('../workers/localInference.worker.ts', import.meta.url), { type: 'module' }))
  } catch {
    return Promise.resolve(null)
  }
}

async function getWorker(): Promise<Worker | null> {
  if (!workerPromise) {
    workerPromise = createWorker().then(async (worker) => {
      if (worker) {
        console.log('[InferenceService] Worker created, testing connection...');
        const ok = await testWorkerConnection(worker);
        if (!ok) {
          console.error('[InferenceService] Worker connection test failed');
          return null;
        }
        console.log('[InferenceService] Worker connection test passed');
      } else {
        console.error('[InferenceService] Failed to create Worker');
      }
      return worker;
    });
  }
  return workerPromise
}

function testWorkerConnection(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    const id = -1;
    const timeout = setTimeout(() => {
      worker.removeEventListener('message', handle);
      resolve(false);
    }, 2000);

    const handle = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id === id) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handle);
        resolve(e.data.payload.labels?.[0] === 'pong');
      }
    };

    worker.addEventListener('message', handle);
    worker.postMessage({ type: 'ping', id });
  });
}

function inferViaWorker(result: AnalyzedName): Promise<string[] | null> {
  return new Promise(async (resolve) => {
    const worker = await getWorker()
    if (!worker) {
      console.warn('[InferenceService] No worker available, falling back');
      resolve(null)
      return
    }

    const id = nextRequestId
    nextRequestId += 1
    pendingRequests.set(id, resolve)
    console.log('[InferenceService] Sending inference request:', id);

    const cleanup = () => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      pendingRequests.delete(id)
    }

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data
      if (data.id !== id) return
      console.log('[InferenceService] Received worker response:', id, data.type);
      cleanup()
      resolve(data.type === 'result' ? data.payload.labels ?? null : null)
    }

    const handleError = (e: ErrorEvent) => {
      console.error('[InferenceService] Worker error:', id, e.message);
      cleanup()
      resolve(null)
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    worker.postMessage({ id, type: 'infer', payload: { result: toSerializableResult(result) } } satisfies WorkerRequest)
  })
}

export async function runLocalAiAnalysis(result: AnalyzedName): Promise<AiAnalysisResult> {
  console.log('[InferenceService] Starting AI analysis...');
  try {
    const labels = await inferViaWorker(result)
    // 检查 labels 是否有效，且不包含错误标记（如单元素 ['pong']）
    if (labels?.length && !(labels.length === 1 && labels[0] === 'pong')) {
      return {
        labels,
        summary: buildSummary(labels, 'model'),
        loadedFromCache: true,
        source: 'model',
      }
    }
  } catch (error) {
    console.warn('[InferenceService] Worker inference failed:', error);
  }

  return getFallbackResult(result)
}
