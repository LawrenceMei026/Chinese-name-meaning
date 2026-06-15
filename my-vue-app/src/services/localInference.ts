import type { AnalyzedName, AiAnalysisResult } from '../types'

type ClassifierManifest = {
  version?: string
  modelPath?: string
  inputName?: string
  outputName?: string
  featureSize?: number
  labels?: string[]
}

type OrtTensor = {
  data: Float32Array
  type: string
  dims: number[]
}

type SessionLike = {
  inputNames: string[]
  outputNames: string[]
  run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, { data: ArrayLike<number> }>>
}

type OrtRuntime = {
  InferenceSession: {
    create: (modelPath: string, options: { executionProviders: string[] }) => Promise<SessionLike>
  }
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor
}

const MODEL_VERSION = 'onnx-v1'
const MODEL_MANIFEST = '/models/manifest.json'
const DEFAULT_MODEL_PATH = '/models/classifier.onnx'
const DEFAULT_LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']

let ortRuntimePromise: Promise<OrtRuntime | null> | null = null
let manifestPromise: Promise<ClassifierManifest | null> | null = null
let cachedManifest: ClassifierManifest | null = null
let sessionPromise: Promise<SessionLike | null> | null = null
let cachedSession: SessionLike | null = null

async function loadOrtRuntime(): Promise<OrtRuntime | null> {
  if (!ortRuntimePromise) {
    ortRuntimePromise = (async () => {
      try {
        // Load the runtime only when the AI panel is used so the base app stays lightweight.
        const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>
        const mod = await importer('onnxruntime-web')
        return ((mod as { default?: unknown }).default ?? mod) as OrtRuntime
      } catch {
        return null
      }
    })()
  }

  return ortRuntimePromise
}

function fetchBaseUrl() {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
}

function normaliseLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return DEFAULT_LABELS
  const cleaned = labels.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
  return cleaned.length ? cleaned : DEFAULT_LABELS
}

async function loadManifest(): Promise<ClassifierManifest | null> {
  if (cachedManifest) return cachedManifest

  if (!manifestPromise) {
    manifestPromise = (async () => {
      const res = await fetch(MODEL_MANIFEST)
      if (!res.ok) return null

      const data: unknown = await res.json().catch(() => null)
      if (!data || typeof data !== 'object') return null

      const manifest = data as ClassifierManifest
      return {
        version: typeof manifest.version === 'string' ? manifest.version : MODEL_VERSION,
        modelPath: typeof manifest.modelPath === 'string' && manifest.modelPath.trim() ? manifest.modelPath : DEFAULT_MODEL_PATH,
        inputName: typeof manifest.inputName === 'string' && manifest.inputName.trim() ? manifest.inputName : 'input',
        outputName: typeof manifest.outputName === 'string' && manifest.outputName.trim() ? manifest.outputName : 'logits',
        featureSize: Number.isFinite(manifest.featureSize) && (manifest.featureSize ?? 0) > 0 ? Math.floor(manifest.featureSize ?? 0) : 16,
        labels: normaliseLabels(manifest.labels),
      }
    })().catch(() => null).finally(() => {
      if (!cachedManifest) manifestPromise = null
    })
  }

  cachedManifest = await manifestPromise
  return cachedManifest
}

async function loadSession(): Promise<SessionLike | null> {
  if (cachedSession) return cachedSession

  if (!sessionPromise) {
    sessionPromise = (async () => {
      const manifest = await loadManifest()
      const ort = await loadOrtRuntime()
      if (!manifest || !ort) return null

      try {
        return await ort.InferenceSession.create(new URL(manifest.modelPath ?? DEFAULT_MODEL_PATH, fetchBaseUrl()).toString(), {
          executionProviders: ['wasm'],
        })
      } catch {
        return null
      }
    })().catch(() => null).finally(() => {
      if (!cachedSession) sessionPromise = null
    })
  }

  cachedSession = await sessionPromise
  return cachedSession
}

function buildFeatureVector(result: AnalyzedName, featureSize: number) {
  const counts = {
    water: 0,
    wood: 0,
    fire: 0,
    metal: 0,
    earth: 0,
    masculine: 0,
    feminine: 0,
    cultural: 0,
    literary: 0,
    gloss: 0,
    meaning: 0,
  }

  for (const char of result.chars) {
    const cultural = char.cultural
    if (cultural?.element === '水') counts.water += 1
    if (cultural?.element === '木') counts.wood += 1
    if (cultural?.element === '火') counts.fire += 1
    if (cultural?.element === '金') counts.metal += 1
    if (cultural?.element === '土') counts.earth += 1
    if (cultural?.genderBias === 'masculine') counts.masculine += 1
    if (cultural?.genderBias === 'feminine') counts.feminine += 1
    if (cultural) {
      counts.cultural += 1
      if (cultural.literaryRef) counts.literary += 1
      if (cultural.localGloss) counts.gloss += 1
    }
    counts.meaning += char.entry?.definitions.length ?? 0
  }

  const features = new Float32Array(featureSize)
  const base = [
    result.chars.length,
    result.chars.filter(char => char.role === 'surname').length,
    result.chars.filter(char => char.role === 'given').length,
    counts.water,
    counts.wood,
    counts.fire,
    counts.metal,
    counts.earth,
    counts.masculine,
    counts.feminine,
    counts.cultural,
    counts.literary,
    counts.gloss,
    counts.meaning,
    result.original.length,
    Number(/[一-鿿]/.test(result.original)),
  ]

  for (let i = 0; i < features.length; i += 1) {
    features[i] = base[i] ?? 0
  }

  return features
}

function buildFeatureText(result: AnalyzedName) {
  const charParts = result.chars.map(char => {
    const entry = char.entry
    const cultural = char.cultural
    const meanings = entry?.definitions.slice(0, 2).join('；') ?? '未收录'
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
  return source === 'fallback' ? `${base} 当前使用的是本地规则回退结果。` : base
}

function getOutputTensor(outputs: Record<string, { data: ArrayLike<number> }>, outputName?: string) {
  if (outputName && outputs[outputName]) return outputs[outputName]!
  const first = Object.values(outputs)[0]
  return first ?? null
}

function pickModelLabels(scores: ArrayLike<number>, labels: string[]) {
  const ranked = Array.from(scores, (score, index) => ({ score, label: labels[index] ?? DEFAULT_LABELS[index] ?? `标签${index + 1}` }))
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.label)
}

async function runClassifier(result: AnalyzedName) {
  const manifest = await loadManifest()
  const session = await loadSession()
  const ort = await loadOrtRuntime()
  if (!manifest || !session || !ort) return null

  const featureSize = manifest.featureSize ?? 16
  const features = buildFeatureVector(result, featureSize)
  const inputName = manifest.inputName ?? session.inputNames[0] ?? 'input'
  const outputName = manifest.outputName ?? session.outputNames[0]

  const outputs = await session.run({ [inputName]: new ort.Tensor('float32', features, [1, featureSize]) })
  const outputTensor = getOutputTensor(outputs, outputName)
  if (!outputTensor) return null

  const scores = outputTensor.data as ArrayLike<number>
  return pickModelLabels(scores, manifest.labels ?? DEFAULT_LABELS)
}

export async function runLocalAiAnalysis(result: AnalyzedName): Promise<AiAnalysisResult> {
  const featureText = buildFeatureText(result)

  try {
    const labels = await runClassifier(result)
    if (labels?.length) {
      return {
        labels,
        summary: buildSummary(labels, 'model'),
        loadedFromCache: true,
        source: 'model',
      }
    }
  } catch {
    // Fall through to deterministic local labels.
  }

  const labels = pickFallbackLabels(featureText)
  return {
    labels,
    summary: buildSummary(labels, 'fallback'),
    loadedFromCache: false,
    source: 'fallback',
  }
}
