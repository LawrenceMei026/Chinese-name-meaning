import type { AnalyzedName } from '../types'
import * as ort from 'onnxruntime-web'
import { FEATURE_CONTRACT, buildFeatureVector } from '../model/nameFeatures'

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
  featureContractVersion?: string
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
          inputName: typeof manifest.inputName === 'string' && manifest.inputName.trim() ? manifest.inputName : 'input',
          outputName: typeof manifest.outputName === 'string' && manifest.outputName.trim() ? manifest.outputName : 'logits',
          featureSize: Number.isFinite(manifest.featureSize) && (manifest.featureSize ?? 0) > 0 ? Math.floor(manifest.featureSize ?? 0) : 16,
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
      if (typeof (ortInstance.env as any).wasm !== 'undefined') {
        (ortInstance.env as any).wasm.numThreads = 1; // Simplify for debugging
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

  if (manifest.featureSize !== FEATURE_CONTRACT.size
    || manifest.featureContractVersion !== FEATURE_CONTRACT.version) {
    console.error('[Worker] Model feature contract mismatch', {
      expectedVersion: FEATURE_CONTRACT.version,
      actualVersion: manifest.featureContractVersion,
      expectedSize: FEATURE_CONTRACT.size,
      actualSize: manifest.featureSize,
    })
    return null
  }

  const featureSize = FEATURE_CONTRACT.size
  const features = buildFeatureVector(result.chars)
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
