import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  const descriptors: Record<string, string> = { '大气': '开阔宏大的格局', '文雅': '书卷润墨的雅致', '柔和': '温婉细腻的质感', '阳刚': '坚毅刚劲的力量', '古典': '古朴隽永的余韵', '现代': '清新明快的时代感' }
  const primaryLabel = labels[0] || '文雅'
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
    workerPromise = createWorker().then(async (worker) => {
      if (worker) {
        const ok = await testWorkerConnection(worker);
        if (!ok) return null;
      }
      return worker;
    });
  }
  return workerPromise
}

function testWorkerConnection(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    const id = -1;
    const timeout = setTimeout(() => resolve(false), 10000);
    const handle = (e: MessageEvent<any>) => {
      const res = e.data;
      if (res && res.id === id) {
        clearTimeout(timeout);
        worker.removeEventListener('message', handle);
        resolve(res.payload?.labels?.[0] === 'pong');
      }
    };
    worker.addEventListener('message', handle);
    worker.postMessage({ type: 'ping', id });
  });
}

function inferViaWorker(result: AnalyzedName): Promise<string[] | null> {
  return new Promise(async (resolve) => {
    const worker = await getWorker()
    if (!worker) { resolve(null); return; }
    const id = nextRequestId++;
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
    }
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return
      cleanup(); resolve(event.data.type === 'result' ? event.data.payload.labels ?? null : null)
    }
    const handleError = () => { cleanup(); resolve(null); }
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    worker.postMessage({ id, type: 'infer', payload: { result: toSerializableResult(result) } } satisfies WorkerRequest)
  })
}

async function fetchOllamaSummary(labels: string[], result: AnalyzedName): Promise<string | null> {
  const prompt = `你是一个精通中国传统文化、文学和取名艺术的专家。名字是“${result.original}”。基调为${labels.join('、')}。结合具体字义生成一段100字左右的文雅姓名意境分析。只输出分析内容。`;

  // 这里的策略是：同时尝试 localhost 和 127.0.0.1，谁快用谁
  // 在 Windows + WSL 环境下，往往其中一个会被拦截，而另一个是通的
  const urls = [
    'http://localhost:11435/api/generate',
    'http://127.0.0.1:11435/api/generate'
  ];

  const fetchWithTimeout = async (url: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'name-expert',
        prompt: prompt,
        stream: false,
        options: { temperature: 0.7 }
      }),
      // 注意：由于模型生成很慢，这里不能设太短的 timeout
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error('Ollama error');
    const data = await response.json();
    return data.response?.trim();
  };

  try {
    // 优先尝试 Tauri Native LLM
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const hasModel = await invoke<boolean>('check_model_exists');
        if (hasModel) {
          const context = buildFeatureText(result);
          const tauriSummary = await invoke<string>('generate_internal_summary', {
            name: result.original,
            context
          });
          return tauriSummary;
        }
      } catch (e) {
        console.error('[Inference] Tauri native LLM failed:', e);
      }
    }

    // 竞速模式：只要有一个通了就用那个
    return await (Promise as any).any(urls.map(url => fetchWithTimeout(url)));
  } catch (e) {
    console.error('[Ollama] All connection attempts failed. Possible CORS or WSL firewall issue.');
    return null;
  }
}

export async function checkNativeModel() {
  if (!(window as any).__TAURI_INTERNALS__) return true;
  return await invoke<boolean>('check_model_exists');
}

export async function checkSystemMemory() {
  if (!(window as any).__TAURI_INTERNALS__) return 16; // Web 模式默认返回足够
  return await invoke<number>('check_memory');
}

export async function startModelDownload(onProgress: (p: { progress: number; total_size: number; downloaded: number }) => void) {
  const unlisten = await listen<{ progress: number; total_size: number; downloaded: number }>('download-progress', (event: any) => {
    onProgress(event.payload);
  });
  try {
    return await invoke<string>('download_model');
  } finally {
    unlisten();
  }
}

export async function runLocalAiAnalysis(result: AnalyzedName): Promise<AiAnalysisResult> {
  let labels: string[] = [];
  let source: 'model' | 'fallback' = 'fallback';
  try {
    const modelLabels = await inferViaWorker(result)
    if (modelLabels?.length && modelLabels[0] !== 'pong') { labels = modelLabels; source = 'model'; }
  } catch {}
  if (labels.length === 0) { labels = pickFallbackLabels(buildFeatureText(result)); source = 'fallback'; }
  const ollamaSummary = await fetchOllamaSummary(labels, result);
  return {
    labels,
    summary: ollamaSummary || buildSummary(labels, result, source),
    loadedFromCache: source === 'model',
    source: source,
  }
}
