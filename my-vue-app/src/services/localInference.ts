import type { AnalyzedName, AiAnalysisResult, CharEntry, CulturalData } from '../types'

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

function cleanDefinition(text: string): string {
  if (!text) return ''
  // 移除元数据：如“杰为傑的俗字”、“义同某”、“见某某”
  let cleaned = text.replace(/.*(?:俗字|义同|见“|亦作).*[。？?！!\s]?/g, '')
  // 移除拼音和重复字符
  cleaned = cleaned.replace(/^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s\d]+/, '')
  // 截取第一个完整句或前15个字
  const match = cleaned.match(/^[^。；;！？!]+/)
  return match ? match[0].trim() : cleaned.slice(0, 15).trim()
}

function buildSummary(labels: string[], result: AnalyzedName, source: 'model' | 'fallback') {
  if (labels.length === 0) return '名字整体音韵和谐，展现出一种平衡而中正的气质。'

  const labelsText = labels.join('、')
  const givenChars = result.chars.filter(c => c.role === 'given')

  // 1. 提取深度字义
  const meaningfulChar = givenChars.find(c => {
    const def = c.entry?.definition_cn || ''
    return def && !def.includes('俗字') && !def.includes('姓')
  }) || givenChars[0]

  const coreMeaning = cleanDefinition(meaningfulChar?.entry?.definition_cn || '')

  // 2. 动态生成开篇
  const openings = [
    `“${result.original}”这个名字`,
    `在“${result.original}”中`,
    `纵观“${result.original}”的选字`
  ]
  const opening = openings[Math.floor(result.original.length % openings.length)]

  // 3. 构建文化逻辑
  let culturalLogic = ''
  const element = givenChars.find(c => c.cultural?.element)?.cultural?.element
  const litRef = givenChars.find(c => c.cultural?.literaryRef)?.cultural?.literaryRef

  if (litRef) {
    culturalLogic = `通过典故的化用，为名字注入了深厚的古典底蕴`
  } else if (element) {
    culturalLogic = `借助“${element}”行的意象，构建了平衡的五行能量`
  } else {
    culturalLogic = `通过精准的选字组合`
  }

  // 4. 定制化转折
  const descriptors: Record<string, string> = {
    '大气': '开阔宏大的格局',
    '文雅': '书卷润墨的雅致',
    '柔和': '温婉细腻的质感',
    '阳刚': '坚毅刚劲的力量',
    '古典': '古朴隽永的余韵',
    '现代': '清新明快的时代感'
  }

  const primaryLabel = labels[0] || '文雅'
  const vibe = descriptors[primaryLabel] || '独特'

  // 5. 组合最终叙事
  let summary = `${opening}${culturalLogic}，${labels.length > 1 ? '在此基础上进一步' : ''}生发出${vibe}。`

  if (coreMeaning && coreMeaning.length > 1) {
    summary += ` 尤其是“${meaningfulChar?.char}”字所代表的“${coreMeaning}”之意，起到了点睛之笔的作用。`
  }

  return source === 'fallback' ? `${summary} (本地解析)` : summary
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
      console.warn('[InferenceService] Worker handshake timed out (10s)');
      resolve(false);
    }, 10000);

    const handle = (e: MessageEvent<any>) => {
      const res = e.data;
      if (res && res.id === id) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handle);
        const labels = res.payload?.labels;
        resolve(Array.isArray(labels) && labels[0] === 'pong');
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

async function fetchOllamaSummary(labels: string[], result: AnalyzedName): Promise<string | null> {
  const prompt = `你是一个精通中国传统文化、文学和取名艺术的专家。名字是“${result.original}”。基调为${labels.join('、')}。结合具体字义生成一段100字左右的文雅姓名意境分析。只输出分析内容。`;

  try {
    // 使用 localhost 是 Windows 穿透到 WSL 的唯一标准途径
    const baseUrl = 'http://localhost:11434';
    console.log('[InferenceService] Attempting Ollama call to:', baseUrl);
    let targetModel = 'name-expert:latest';

    if (tagsRes?.ok) {
      const tagsData = await tagsRes.json();
      const models = tagsData.models || [];
      const found = models.find((m: any) => m.name.includes('name-expert')) ||
                    models.find((m: any) => m.name.includes('qwen'));
      if (found) {
        targetModel = found.name;
        console.log('[InferenceService] Detected model:', targetModel);
      }
    }

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        prompt: prompt,
        stream: false,
        options: { temperature: 0.7 }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.warn('[InferenceService] Ollama API error. Status:', response.status, 'Model:', targetModel);
      return null;
    }
    const data = await response.json();
    return data.response?.trim() || null;
  } catch (e) {
    console.warn('[InferenceService] Ollama connection failed. Check if OLLAMA_HOST=0.0.0.0');
    return null;
  }
}

export async function runLocalAiAnalysis(result: AnalyzedName): Promise<AiAnalysisResult> {
  console.log('[InferenceService] Starting AI analysis...');
  let labels: string[] = [];
  let source: 'model' | 'fallback' = 'fallback';

  try {
    const modelLabels = await inferViaWorker(result)
    if (modelLabels?.length && !(modelLabels.length === 1 && modelLabels[0] === 'pong')) {
      labels = modelLabels;
      source = 'model';
    }
  } catch (error) {
    console.warn('[InferenceService] Worker inference failed:', error);
  }

  if (labels.length === 0) {
    labels = pickFallbackLabels(buildFeatureText(result));
    source = 'fallback';
  }

  // 尝试使用 Ollama (Qwen) 生成总结
  const ollamaSummary = await fetchOllamaSummary(labels, result);

  return {
    labels,
    summary: ollamaSummary || buildSummary(labels, result, source),
    loadedFromCache: source === 'model',
    source: source,
  }
}
