import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyzedName } from '../types'

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown }

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<() => Promise<() => void>>(),
}))

const result: AnalyzedName = {
  original: '李明',
  chars: [
    { char: '李', role: 'surname', entry: null, cultural: null },
    {
      char: '明',
      role: 'given',
      entry: { pinyin: 'míng', tones: '2', definition_cn: '明亮' },
      cultural: null,
    },
  ],
}

describe('grounded name summary prompts', () => {
  it('supplies parsed facts and prohibits unsupported biography', async () => {
    const { buildGroundedSummaryPrompt } = await import('../services/localInference')
    const prompt = buildGroundedSummaryPrompt(['书卷', '典雅'], result)

    expect(prompt).toContain('李：角色=姓氏')
    expect(prompt).toContain('明：角色=名字；字义=明亮')
    expect(prompt).not.toContain('读音=míng')
    expect(prompt).toContain('不得把姓名识别为真实人物')
    expect(prompt).toContain('不得补充字号、朝代、官职、职业、生平')
    expect(prompt).toContain('只允许使用下列已提供事实')
  })

  it('rejects unsupported biographical claims from generated text', async () => {
    const { isGroundedSummary } = await import('../services/localInference')

    expect(isGroundedSummary('“明”字取光明通达之意，与清朗意境相映，使名字呈现澄澈开阔的气质；明亮并非浮于表面的耀眼，而是内心清醒、待人坦荡的温润表达，寄托行事坚定、思路通达且前路明朗的美好愿景。', result)).toBe(true)
    expect(isGroundedSummary('乐毅，字子渊，是春秋时期著名军事家。', result)).toBe(false)
    expect(isGroundedSummary('单于明，汉唐以来多有所指，意为光耀先贤，象征国家兴盛。', result)).toBe(false)
    expect(isGroundedSummary('结合具体字义生成一段100字左右的文雅姓名意境分析。', result)).toBe(false)
    expect(isGroundedSummary('读音：ming2。名字光明开阔，象征国家繁荣与民族昌盛，寄托美好愿景。', result)).toBe(false)
    expect(isGroundedSummary('李明字文彬，在书法方面有深厚造诣，他的作品典雅而富有诗意，深受读者喜爱。', result)).toBe(false)
    expect(isGroundedSummary('李明（明）字孔明，号卧龙，人称卧龙先生，以智慧和才华著称，被誉为一代名士。', result)).toBe(false)
    expect(isGroundedSummary('“明”字清澈开朗，与温润宜人的气质相映；名字整体简洁舒展，既有内心明净的含蓄表达，也寄托待人坦荡、思路通达、步履从容的美好愿景，在平和之中保有坚定而清醒的力量。', result)).toBe(true)
  })
})

describe('model download errors', () => {
  it('preserves the native download failure reason', async () => {
    const { formatModelDownloadError } = await import('../services/localInference')

    expect(formatModelDownloadError('connection timed out')).toBe('模型下载失败：connection timed out')
    expect(formatModelDownloadError(new Error('disk full'))).toBe('模型下载失败：disk full')
    expect(formatModelDownloadError(null)).toBe('模型下载失败，请检查网络设置后重试。')
  })

  it('reads and configures the native model directory', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_model_directory') return Promise.resolve('D:\\ChineseNameModels')
      if (command === 'set_model_directory') return Promise.resolve('D:\\ChineseNameModels')
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { getModelDirectory, setModelDirectory } = await import('../services/localInference')

    await expect(getModelDirectory()).resolves.toBe('D:\\ChineseNameModels')
    await expect(setModelDirectory('D:\\ChineseNameModels')).resolves.toBe('D:\\ChineseNameModels')
    expect(invokeMock).toHaveBeenLastCalledWith('set_model_directory', { directory: 'D:\\ChineseNameModels' })
  })
})

class FakeWorker {
  static instances: FakeWorker[] = []

  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  respondToPing = true
  respondToInfer = false
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: { type: string; id: number }) {
    if (message.type === 'ping' && this.respondToPing) {
      queueMicrotask(() => this.emit('message', {
        data: { id: message.id, type: 'result', payload: { labels: ['pong'] } },
      } as MessageEvent))
    }
    if (message.type === 'infer' && this.respondToInfer) {
      queueMicrotask(() => this.emit('message', {
        data: { id: message.id, type: 'result', payload: { labels: ['书卷'] } },
      } as MessageEvent))
    }
  }

  terminate() {
    this.terminated = true
  }

  private emit(type: string, event: MessageEvent) {
    this.listeners.get(type)?.forEach(listener => listener(event))
  }
}

describe('local inference worker recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Ollama unavailable')))
    invokeMock.mockReset()
    delete (window as TauriWindow).__TAURI_INTERNALS__
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('falls back when inference does not respond', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(analysis.source).toBe('fallback')
    expect(analysis.labels.every(label => ['书卷', '宏伟', '豪迈', '恬静', '典雅', '新颖', '灵动', '坚毅', '自然', '深邃'].includes(label))).toBe(true)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances.every(worker => worker.terminated)).toBe(true)
  })

  it('creates a new worker after a health-check timeout', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor() {
        super()
        if (FakeWorker.instances.length === 1) this.respondToPing = false
      }
    })

    const firstAnalysis = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    await firstAnalysis

    const secondAnalysis = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    await secondAnalysis

    expect(FakeWorker.instances).toHaveLength(4)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
  })

  it('recovers after Worker construction fails', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    let attempts = 0
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor() {
        attempts += 1
        if (attempts === 1) throw new Error('Worker unavailable')
        super()
      }
    })

    const analysis = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    await analysis

    expect(attempts).toBe(2)
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('recovers after a health-check postMessage throws', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    vi.stubGlobal('Worker', class extends FakeWorker {
      postMessage(message: { type: string; id: number }) {
        if (FakeWorker.instances.length === 1) throw new Error('Worker is closed')
        super.postMessage(message)
      }
    })

    const analysis = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    await analysis

    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
  })

  it('settles concurrent requests when their shared worker times out', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analyses = [runLocalAiAnalysis(result), runLocalAiAnalysis(result)]
    await vi.runAllTimersAsync()
    const resolved = await Promise.all(analyses)

    expect(resolved.every(analysis => analysis.source === 'fallback')).toBe(true)
    expect(FakeWorker.instances).toHaveLength(4)
    expect(FakeWorker.instances.every(worker => worker.terminated)).toBe(true)
  })

  it('keeps queued Worker requests serialized when a waiter is cancelled', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    const controller = new AbortController()

    const first = runLocalAiAnalysis(result)
    const cancelled = runLocalAiAnalysis(result, { signal: controller.signal })
    const cancellation = cancelled.catch(error => error)
    const third = runLocalAiAnalysis(result)
    controller.abort()
    expect(await cancellation).toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.instances).toHaveLength(1)
    await vi.runAllTimersAsync()

    const [firstAnalysis, thirdAnalysis] = await Promise.all([first, third])
    expect(firstAnalysis.source).toBe('fallback')
    expect(thirdAnalysis.source).toBe('fallback')
    expect(FakeWorker.instances).toHaveLength(4)
  })

  it('aborts and retries timed-out Ollama requests', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(call => call[1]?.signal?.aborted)).toBe(true)
    expect(analysis.summary).toContain('本地解析')
  })

  it('tries equivalent Ollama addresses sequentially on the standard port', async () => {
    let resolveFirst!: (response: Response) => void
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve }))
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '“明”字取光明通达之意，与清朗意境相映，使名字呈现澄澈开阔的气质；明亮并非浮于表面的耀眼，而是内心清醒、待人坦荡的温润表达，寄托行事坚定、思路通达且前路明朗的美好愿景。' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor() {
        super()
        this.respondToInfer = true
      }
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/generate')
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { prompt: string }
    expect(request.prompt).toContain('明：角色=名字；字义=明亮')
    expect(request.prompt).toContain('不得补充字号、朝代、官职、职业、生平')

    resolveFirst({ ok: false } as Response)
    await vi.advanceTimersByTimeAsync(250)
    const analysis = await analysisPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:11434/api/generate')
    expect(analysis.summary).toContain('“明”字取光明通达之意')
  })

  it('cancels the complete inference chain through AbortSignal', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor() {
        super()
        this.respondToInfer = true
      }
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')
    const controller = new AbortController()

    const analysisPromise = runLocalAiAnalysis(result, { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()

    await expect(analysisPromise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/generate')
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('cancels and retries timed-out native inference', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    const generations = new Map<string, (error: Error) => void>()
    invokeMock.mockImplementation((command: string, args?: { requestId?: string }) => {
      if (command === 'check_model_exists') return Promise.resolve(true)
      if (command === 'cancel_internal_summary') {
        generations.get(args?.requestId ?? '')?.(new Error('Inference cancelled'))
        return Promise.resolve()
      }
      if (command === 'generate_internal_summary') {
        return new Promise((_resolve, reject) => {
          generations.set(args?.requestId ?? '', reject)
        })
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    await analysisPromise

    expect(invokeMock.mock.calls.filter(call => call[0] === 'generate_internal_summary')).toHaveLength(2)
    expect(invokeMock.mock.calls.filter(call => call[0] === 'cancel_internal_summary')).toHaveLength(2)
  })

  it('does not overlap an uncancellable timed-out native model check', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    invokeMock.mockImplementation((command: string) => {
      if (command === 'check_model_exists') return new Promise(() => {})
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(invokeMock.mock.calls.filter(call => call[0] === 'check_model_exists')).toHaveLength(1)
    expect(analysis.summary).toContain('本地解析')
  })

  it('cancels native inference without retrying after a user abort', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor() {
        super()
        this.respondToInfer = true
      }
    })
    invokeMock.mockImplementation((command: string) => {
      if (command === 'check_model_exists') return Promise.resolve(true)
      if (command === 'generate_internal_summary') return new Promise(() => {})
      if (command === 'cancel_internal_summary') return Promise.resolve()
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')
    const controller = new AbortController()

    const analysisPromise = runLocalAiAnalysis(result, { signal: controller.signal })
    const rejected = analysisPromise.catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.runAllTimersAsync()
    expect(await rejected).toMatchObject({ name: 'AbortError' })

    expect(invokeMock.mock.calls.filter(call => call[0] === 'generate_internal_summary')).toHaveLength(1)
    expect(invokeMock.mock.calls.filter(call => call[0] === 'cancel_internal_summary')).toHaveLength(1)
  })

  it('stops the chain when native cancellation cannot be confirmed', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
    invokeMock.mockImplementation((command: string) => {
      if (command === 'check_model_exists') return Promise.resolve(true)
      if (command === 'generate_internal_summary') return new Promise(() => {})
      if (command === 'cancel_internal_summary') return new Promise(() => {})
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(invokeMock.mock.calls.filter(call => call[0] === 'generate_internal_summary')).toHaveLength(1)
    expect(invokeMock.mock.calls.filter(call => call[0] === 'cancel_internal_summary')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(analysis.summary).toContain('本地解析')
  })
})
