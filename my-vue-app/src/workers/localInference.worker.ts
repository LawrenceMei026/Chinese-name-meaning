import * as ort from 'onnxruntime-web'
import { FEATURE_CONTRACT, buildFeatureVector } from '../model/nameFeatures'
import type { FeatureInput } from '../model/nameFeatures'

type OrtRuntime = typeof ort

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
const DEFAULT_MODEL_PATH = '/models/classifier.onnx'
const DEFAULT_LABELS = FEATURE_CONTRACT.labels
const MODEL_LABEL_THRESHOLD = 0.45
const MODEL_MAX_LABELS = 2
const MODEL_MIN_MARGIN = 0.05

type ClassifierManifest = {
  version?: string
  modelPath?: string
  modelSize?: number
  modelSha256?: string
  inputName?: string
  outputName?: string
  featureSize?: number
  outputSize?: number
  featureContractVersion?: string
  labels?: string[]
}

type SessionLike = ort.InferenceSession

let manifestPromise: Promise<ClassifierManifest | null> | null = null
let cachedManifest: ClassifierManifest | null = null
let sessionPromise: Promise<SessionLike | null> | null = null
let cachedSession: SessionLike | null = null

function baseUrl() {
  // In Tauri/Vite environment, we need to handle both dev server and production custom protocols
  if (typeof self !== 'undefined' && self.location) {
    const url = new URL(self.location.href);

    // Tauri production check: usually starts with tauri:// or https://tauri.localhost
    const isTauri = url.protocol === 'tauri:' || url.hostname === 'tauri.localhost';

    if (isTauri) {
      // In Tauri production, base path should generally be the root of the origin
      return url.origin + (import.meta.env.BASE_URL || '/');
    }
  }

  // Fallback for standard web/dev environments
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base, self.location.origin).toString();
}

async function loadOrtRuntime(): Promise<OrtRuntime | null> {
  return ort
}

function normaliseLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return DEFAULT_LABELS
  const cleaned = labels.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
  return cleaned.length ? cleaned : DEFAULT_LABELS
}

export function hasExpectedLabelOrder(labels: readonly string[]): boolean {
  return labels.length === FEATURE_CONTRACT.labels.length
    && labels.every((label, index) => label === FEATURE_CONTRACT.labels[index])
}

export function hasOnlyFiniteScores(scores: ArrayLike<number>): boolean {
  return Array.from(scores).every(score => Number.isFinite(score))
}

export function normaliseDigest(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/u.test(value) ? value.toLowerCase() : undefined
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bytesToHex(new Uint8Array(digest))
}

async function loadManifest(): Promise<ClassifierManifest | null> {
  if (cachedManifest) return cachedManifest

  if (!manifestPromise) {
    manifestPromise = (async () => {
      // 更加稳健的路径获取：优先尝试绝对路径解析，失败则尝试相对路径
      const baseUrlStr = baseUrl();
      const urls = [
        new URL('models/manifest.json', baseUrlStr).toString(),
        './models/manifest.json'
      ];

      let res: Response | null = null;
      for (const url of urls) {
        try {
          console.log('[Worker] Trying manifest URL:', url);
          // In Tauri production, using 'same-origin' can help avoid some protocol issues
          const attempt = await fetch(url, { mode: 'cors' });
          if (attempt.ok) {
            res = attempt;
            break;
          }
        } catch (e) {
          console.warn(`[Worker] Failed manifest attempt: ${url}`, e);
        }
      }

      if (!res || !res.ok) {
        console.error('[Worker] All manifest load attempts failed');
        return null;
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
          modelSize: Number.isFinite(manifest.modelSize) && (manifest.modelSize ?? 0) > 0 ? Math.floor(manifest.modelSize ?? 0) : undefined,
          modelSha256: normaliseDigest(manifest.modelSha256),
          inputName: typeof manifest.inputName === 'string' && manifest.inputName.trim() ? manifest.inputName : 'input',
          outputName: typeof manifest.outputName === 'string' && manifest.outputName.trim() ? manifest.outputName : 'logits',
          featureSize: Number.isFinite(manifest.featureSize) && (manifest.featureSize ?? 0) > 0 ? Math.floor(manifest.featureSize ?? 0) : 16,
          outputSize: Number.isFinite(manifest.outputSize) && (manifest.outputSize ?? 0) > 0 ? Math.floor(manifest.outputSize ?? 0) : undefined,
          featureContractVersion: typeof manifest.featureContractVersion === 'string' ? manifest.featureContractVersion : undefined,
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

      // Configure WASM paths explicitly for Tauri/Vite environment
      const base = baseUrl();
      // Ensure base ends with a slash
      const wasmBase = base.endsWith('/') ? base : base + '/';

      ortInstance.env.debug = true;
      ortInstance.env.wasm.wasmPaths = wasmBase;
      // Force disable proxy to avoid separate worker/mjs loading if possible
      ortInstance.env.wasm.proxy = false;
      console.log('[Worker] Set ort.env.wasm.wasmPaths to:', wasmBase);

      // Disable dynamic loading of modules to avoid the .mjs fetch error in some environments
      // and force the use of local WASM files
      if (typeof ortInstance.env.wasm !== 'undefined') {
        ortInstance.env.wasm.numThreads = 1; // Simplify for debugging
      }

      try {
        const cleanPath = (manifest.modelPath ?? DEFAULT_MODEL_PATH).replace(/^\//, '');
        const modelUrl = new URL(cleanPath, base).toString();

        console.log('[Worker] Loading ONNX model from URL:', modelUrl);

        // Try to fetch as arrayBuffer first
        const response = await fetch(modelUrl, { cache: 'no-cache' });
        if (!response.ok) {
          throw new Error(`Model fetch failed: ${response.status} ${response.statusText} for ${modelUrl}`);
        }
        const modelBuffer = await response.arrayBuffer();

        if (manifest.modelSize && modelBuffer.byteLength !== manifest.modelSize) {
          throw new Error(`Model size mismatch: expected ${manifest.modelSize}, received ${modelBuffer.byteLength}`)
        }
        if (manifest.modelSha256) {
          const digest = await sha256Hex(modelBuffer)
          if (!digest) {
            throw new Error('SHA-256 verification unavailable in this runtime')
          }
          if (digest !== manifest.modelSha256) {
            throw new Error(`Model SHA-256 mismatch: expected ${manifest.modelSha256}, received ${digest}`)
          }
        }

        if (modelBuffer.byteLength < 5000) {
          console.warn('[Worker] Model buffer is suspiciously small (<5KB). It might be a skeleton model missing external data.');
        }

        console.log('[Worker] Model buffer loaded, size:', modelBuffer.byteLength);

        try {
          return await ortInstance.InferenceSession.create(modelBuffer, {
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: 'all',
            enableMemPattern: true,
            enableCpuMemArena: true
          })
        } catch (sessionErr) {
          console.warn('[Worker] Primary session creation (webgpu) failed, retrying with wasm only:', sessionErr);
          return await ortInstance.InferenceSession.create(modelBuffer, {
            executionProviders: ['wasm']
          })
        }
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

function getOutputTensor(outputs: ort.InferenceSession.OnnxValueMapType, outputName?: string) {
  if (outputName && outputs[outputName]) return outputs[outputName]!
  const first = Object.values(outputs)[0]
  return first ?? null
}

export function pickModelLabels(scores: ArrayLike<number>, labels: string[]) {
  const ranked = Array.from(scores, (score, index) => ({ score, label: labels[index] ?? DEFAULT_LABELS[index] ?? `标签${index + 1}` }))
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) return []

  const first = ranked[0]
  const second = ranked[1]
  if (!first || first.score < MODEL_LABEL_THRESHOLD) return []
  if (second && first.score - second.score < MODEL_MIN_MARGIN) return []

  return ranked
    .filter(item => item.score >= MODEL_LABEL_THRESHOLD)
    .slice(0, MODEL_MAX_LABELS)
    .map(item => item.label)
}

async function runClassifier(result: FeatureInput) {
  const manifest = await loadManifest()
  const session = await loadSession()
  const ortInstance = await loadOrtRuntime()
  if (!manifest || !session || !ortInstance) return null

  if (manifest.featureSize !== FEATURE_CONTRACT.size
    || manifest.featureContractVersion !== FEATURE_CONTRACT.version
    || manifest.outputSize !== FEATURE_CONTRACT.labels.length
    || !hasExpectedLabelOrder(manifest.labels ?? DEFAULT_LABELS)) {
    console.error('[Worker] Model feature contract mismatch', {
      expectedVersion: FEATURE_CONTRACT.version,
      actualVersion: manifest.featureContractVersion,
      expectedSize: FEATURE_CONTRACT.size,
      actualSize: manifest.featureSize,
      expectedOutputSize: FEATURE_CONTRACT.labels.length,
      actualOutputSize: manifest.outputSize,
      expectedLabels: FEATURE_CONTRACT.labels,
      actualLabels: manifest.labels,
    })
    return null
  }

  const featureSize = FEATURE_CONTRACT.size
  const features = buildFeatureVector(result.chars)
  const inputName = manifest.inputName ?? session.inputNames[0] ?? 'input'
  const outputName = manifest.outputName ?? session.outputNames[0]

  const outputs = await session.run({ [inputName]: new ortInstance.Tensor('float32', features, [1, featureSize]) })
  const outputTensor = getOutputTensor(outputs, outputName)
  if (!outputTensor || !('data' in outputTensor)) return null

  const scores = outputTensor.data as ArrayLike<number>
  const labels = manifest.labels ?? DEFAULT_LABELS
  if (scores.length !== FEATURE_CONTRACT.labels.length || labels.length !== FEATURE_CONTRACT.labels.length) {
    console.error('[Worker] Model output contract mismatch', {
      expectedLabels: FEATURE_CONTRACT.labels.length,
      actualScores: scores.length,
      actualLabels: labels.length,
    })
    return null
  }
  if (!hasOnlyFiniteScores(scores)) {
    console.error('[Worker] Model produced non-finite scores', {
      scores: Array.from(scores),
    })
    return null
  }
  return pickModelLabels(scores, labels)
}

if (typeof self !== 'undefined' && 'addEventListener' in self) {
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
}
