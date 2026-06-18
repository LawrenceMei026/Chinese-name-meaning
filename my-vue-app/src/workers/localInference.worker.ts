import type { AnalyzedName } from '../types'

type WorkerRequest = {
  id: number
  type: 'infer'
  payload: { result: AnalyzedName }
}

type WorkerResponse = {
  id: number
  type: 'result' | 'error'
  payload: { labels?: string[]; message?: string }
}

const MODEL_VERSION = 'onnx-v1'
const DEFAULT_MODEL_PATH = '/models/classifier.onnx'
const DEFAULT_LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']

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

let ortRuntimePromise: Promise<OrtRuntime | null> | null = null
let manifestPromise: Promise<ClassifierManifest | null> | null = null
let cachedManifest: ClassifierManifest | null = null
let sessionPromise: Promise<SessionLike | null> | null = null
let cachedSession: SessionLike | null = null

function baseUrl() {
  return new URL(import.meta.env.BASE_URL, self.location.href).toString()
}

function assetUrl(path: string) {
  return new URL(path, baseUrl()).toString()
}

async function loadOrtRuntime(): Promise<OrtRuntime | null> {
  if (!ortRuntimePromise) {
    ortRuntimePromise = (async () => {
      try {
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

function normaliseLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return DEFAULT_LABELS
  const cleaned = labels.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
  return cleaned.length ? cleaned : DEFAULT_LABELS
}

async function loadManifest(): Promise<ClassifierManifest | null> {
  if (cachedManifest) return cachedManifest

  if (!manifestPromise) {
    manifestPromise = (async () => {
      const res = await fetch(assetUrl('models/manifest.json'))
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
        return await ort.InferenceSession.create(new URL(manifest.modelPath ?? DEFAULT_MODEL_PATH, baseUrl()).toString(), {
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
    counts.meaning += char.entry?.definition_cn ? 1 : 0
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

self.addEventListener('message', async (event: MessageEvent<WorkerRequest | { type: 'ping', id: number }>) => {
  if (event.data.type === 'ping') {
    console.log('[Worker] Received ping, sending pong');
    self.postMessage({ id: event.data.id, type: 'result', payload: { labels: ['pong'] } });
    return;
  }

  if (event.data.type !== 'infer') return;

  console.log('[Worker] Received inference request:', event.data.id);
  try {
    const labels = await runClassifier(event.data.payload.result)
    console.log('[Worker] Inference complete:', labels);
    const response: WorkerResponse = labels?.length
      ? { id: event.data.id, type: 'result', payload: { labels } }
      : { id: event.data.id, type: 'error', payload: { message: 'model unavailable' } }
    self.postMessage(response)
  } catch (error) {
    console.error('[Worker] Inference failed:', error);
    const response: WorkerResponse = {
      id: event.data.id,
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'worker failed' },
    }
    self.postMessage(response)
  }
})
