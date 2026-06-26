import type { AnalyzedName } from '../types'
import * as ort from 'onnxruntime-web'

type OrtRuntime = typeof ort

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
// 扩展更具差异化的标签体系
const DEFAULT_LABELS = [
  '书卷', '宏伟', '豪迈', '恬静',
  '典雅', '新颖', '灵动', '坚毅',
  '自然', '深邃'
]

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

let manifestPromise: Promise<ClassifierManifest | null> | null = null
let cachedManifest: ClassifierManifest | null = null
let sessionPromise: Promise<SessionLike | null> | null = null
let cachedSession: SessionLike | null = null

function baseUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return new URL(base, self.location.href).toString()
}

function assetUrl(path: string) {
  return new URL(path, baseUrl()).toString()
}

async function loadOrtRuntime(): Promise<OrtRuntime | null> {
  return ort as any
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
      const url = assetUrl('models/manifest.json');
      console.log('[Worker] Fetching manifest from:', url);
      const res = await fetch(url)
      if (!res.ok) {
        console.error('[Worker] Failed to fetch manifest:', res.status, res.statusText);
        return null
      }

      const text = await res.text();
      if (text.trim().startsWith('<')) {
        console.warn('[Worker] Manifest request returned HTML instead of JSON. Ensure models/manifest.json exists.');
        return null;
      }

      try {
        const manifest = JSON.parse(text) as ClassifierManifest
        return {
          version: typeof manifest.version === 'string' ? manifest.version : MODEL_VERSION,
          modelPath: typeof manifest.modelPath === 'string' && manifest.modelPath.trim() ? manifest.modelPath : DEFAULT_MODEL_PATH,
          inputName: typeof manifest.inputName === 'string' && manifest.inputName.trim() ? manifest.inputName : 'input',
          outputName: typeof manifest.outputName === 'string' && manifest.outputName.trim() ? manifest.outputName : 'logits',
          featureSize: Number.isFinite(manifest.featureSize) && (manifest.featureSize ?? 0) > 0 ? Math.floor(manifest.featureSize ?? 0) : 16,
          labels: normaliseLabels(manifest.labels),
        }
      } catch (err) {
        console.error('[Worker] Manifest JSON parse error:', err);
        return null;
      }
    })().catch((err) => {
       console.error('[Worker] Manifest load exception:', err);
       return null;
    }).finally(() => {
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
      const ortInstance = await loadOrtRuntime()
      if (!manifest || !ortInstance) {
        console.error('[Worker] Cannot init session: manifest or ORT missing', { hasManifest: !!manifest, hasOrt: !!ortInstance });
        return null
      }

      try {
        const modelUrl = new URL(manifest.modelPath ?? DEFAULT_MODEL_PATH, baseUrl()).toString();
        console.log('[Worker] Loading ONNX model from:', modelUrl);
        // 尝试多种执行后端，并开启图优化
        return await ortInstance.InferenceSession.create(modelUrl, {
          executionProviders: ['webgpu', 'wasm'],
          graphOptimizationLevel: 'all',
          enableMemPattern: true,
          enableCpuMemArena: true
        })
      } catch (err) {
        console.error('[Worker] ONNX Session creation failed:', err);
        return null
      }
    })().catch((err) => {
      console.error('[Worker] Session load exception:', err);
      return null;
    }).finally(() => {
      if (!cachedSession) sessionPromise = null
    })
  }

  cachedSession = await sessionPromise
  return cachedSession
}

function buildFeatureVector(result: AnalyzedName, featureSize: number) {
  const counts = {
    water: 0, wood: 0, fire: 0, metal: 0, earth: 0,
    masculine: 0, feminine: 0,
    literary: 0,
    natureRadical: 0,
    humanRadical: 0,
    abstractRadical: 0
  }

  let totalVowels = 0
  let openVowels = 0
  let toneChanges = 0
  let lastTone = -1
  let totalFreq = 0

  for (const char of result.chars) {
    const cultural = char.cultural
    const entry = char.entry

    if (cultural?.element === '水') counts.water += 1
    if (cultural?.element === '木') counts.wood += 1
    if (cultural?.element === '火') counts.fire += 1
    if (cultural?.element === '金') counts.metal += 1
    if (cultural?.element === '土') counts.earth += 1
    if (cultural?.genderBias === 'masculine') counts.masculine += 1
    if (cultural?.genderBias === 'feminine') counts.feminine += 1
    if (cultural?.literaryRef) counts.literary += 1

    const radical = entry?.radical || cultural?.localGloss || ''
    if (/[木氵山]/.test(radical)) counts.natureRadical += 1
    if (/[亻纟文]/.test(radical)) counts.humanRadical += 1
    if (/[忄力心]/.test(radical)) counts.abstractRadical += 1
  }

  const len = result.chars.length || 1
  const features = new Float32Array(featureSize)

  // 用于在循环中暂存特征
  const tempFeatures = {
    strongInitials: 0
  }

  for (const char of result.chars) {
    const cultural = char.cultural
    const entry = char.entry

    if (cultural?.element === '水') counts.water += 1
    if (cultural?.element === '木') counts.wood += 1
    if (cultural?.element === '火') counts.fire += 1
    if (cultural?.element === '金') counts.metal += 1
    if (cultural?.element === '土') counts.earth += 1
    if (cultural?.genderBias === 'masculine') counts.masculine += 1
    if (cultural?.genderBias === 'feminine') counts.feminine += 1
    if (cultural?.literaryRef) counts.literary += 1

    const radical = entry?.radical || cultural?.localGloss || ''
    if (/[木氵山]/.test(radical)) counts.natureRadical += 1
    if (/[亻纟文]/.test(radical)) counts.humanRadical += 1
    if (/[忄力心]/.test(radical)) counts.abstractRadical += 1

    // 语义分析：对释义进行关键词扫描，增强字义贴合度
    const definition = entry?.definition_cn || ''
    const semanticWeights = {
      beauty: (definition.match(/[美秀丽华雅]/g) || []).length,
      strength: (definition.match(/[强刚劲力伟]/g) || []).length,
      virtue: (definition.match(/[德贤善诚礼]/g) || []).length,
      nature: (definition.match(/[山川云雨林]/g) || []).length,
    }

    const pinyin = entry?.pinyin.toLowerCase() || ''
    // 识别声母特征 (b, p, d, t, k, g 等塞音通常给人较强硬、响亮的感觉)
    const initials = pinyin.split(/[aeoiuü]/)[0] || ''
    if (/[bpdkgt]/.test(initials)) tempFeatures.strongInitials += 1

    const vowels = pinyin.match(/[aeoiuü]/g) || []
    totalVowels += vowels.length
    openVowels += vowels.filter(v => /[aeo]/.test(v)).length

    const currentTone = parseInt(entry?.tones || '0')
    if (lastTone !== -1 && currentTone > 0) {
      const lastPingZe = lastTone <= 2 ? 0 : 1
      const currentPingZe = currentTone <= 2 ? 0 : 1
      if (lastPingZe !== currentPingZe) toneChanges += 1
    }
    lastTone = currentTone
    totalFreq += entry?.freq || 5
  }

  features[0] = len / 4
  features[1] = result.chars.filter(c => c.role === 'surname').length > 1 ? 1 : 0
  features[2] = (counts.masculine - counts.feminine) / len

  let uniqueElements = 0
  if (counts.water > 0) uniqueElements++
  if (counts.wood > 0) uniqueElements++
  if (counts.fire > 0) uniqueElements++
  if (counts.metal > 0) uniqueElements++
  if (counts.earth > 0) uniqueElements++
  features[3] = uniqueElements / 5

  features[4] = counts.literary / len
  features[5] = counts.metal / len
  features[6] = counts.wood / len
  features[7] = counts.water / len
  features[8] = counts.fire / len
  features[9] = counts.earth / len
  features[10] = totalVowels > 0 ? openVowels / totalVowels : 0
  features[11] = len > 1 ? toneChanges / (len - 1) : 0
  // 集成语义得分到特征向量中，使输出更贴合汉字释义
  const semanticScores = {
    beauty: 0, strength: 0, virtue: 0, nature: 0
  }

  for (const char of result.chars) {
    const entry = char.entry
    const def = entry?.definition_cn || ''
    if (/[美秀丽华雅]/.test(def)) semanticScores.beauty += 1
    if (/[强刚劲力伟]/.test(def)) semanticScores.strength += 1
    if (/[德贤善诚礼]/.test(def)) semanticScores.virtue += 1
    if (/[山川云雨林]/.test(def)) semanticScores.nature += 1
  }

  features[12] = (counts.natureRadical / len + (semanticScores.nature / len)) / 2
  features[13] = (counts.humanRadical / len + (semanticScores.virtue / len)) / 2
  features[14] = (counts.abstractRadical / len + (semanticScores.strength / len)) / 2
  // 将审美得分与塞音强度结合
  features[15] = (tempFeatures.strongInitials / len) * 0.4 + (semanticScores.beauty / len) * 0.6

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
  const ortInstance = await loadOrtRuntime()
  if (!manifest || !session || !ortInstance) return null

  const featureSize = manifest.featureSize ?? 16
  const features = buildFeatureVector(result, featureSize)
  const inputName = manifest.inputName ?? session.inputNames[0] ?? 'input'
  const outputName = manifest.outputName ?? session.outputNames[0]

  const outputs = await session.run({ [inputName]: new ortInstance.Tensor('float32', features, [1, featureSize]) })
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
