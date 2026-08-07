import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyzedName, CulturalData } from '../types'

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

const liMinghua: AnalyzedName = {
  original: '李明华',
  chars: [
    { char: '李', role: 'surname', entry: null, cultural: null },
    {
      char: '明',
      role: 'given',
      entry: { pinyin: 'ming2', tones: '2', definition_cn: '会意。甲骨文以日、月发光表示明亮。' },
      cultural: {
        element: '火',
        elementEmoji: '🔥',
        connotation: '光明、明晰与开朗；常用来表示聪慧、澄澈的心性。',
        genderBias: 'neutral',
        literaryRef: '可联想到《大学》中的“明德”。',
        localGloss: '明亮、清楚、开朗',
      },
    },
    {
      char: '华',
      role: 'given',
      entry: { pinyin: 'hua2', tones: '2', definition_cn: '光彩美丽' },
      cultural: {
        element: '木',
        elementEmoji: '🌿',
        connotation: '华美、繁盛与文化气息；也可指中华之“华”。',
        genderBias: 'neutral',
        localGloss: '华美、光彩、繁盛',
      },
    },
  ],
}

const yueYi: AnalyzedName = {
  original: '乐毅',
  chars: [
    { char: '乐', role: 'surname', entry: null, cultural: null },
    {
      char: '毅',
      role: 'given',
      entry: { pinyin: 'yi4', tones: '4', definition_cn: '形声。从殳，殳指兵器。' },
      cultural: {
        element: '木',
        elementEmoji: '🌿',
        connotation: '坚定、果决与持守；常用来表达意志坚韧、行事有担当。',
        genderBias: 'masculine',
        localGloss: '意志坚定、果决刚健',
      },
    },
  ],
}

const ouyangNana: AnalyzedName = {
  original: '欧阳娜娜',
  chars: [
    { char: '欧', role: 'surname', entry: null, cultural: null },
    { char: '阳', role: 'surname', entry: null, cultural: null },
    {
      char: '娜',
      role: 'given',
      entry: { pinyin: 'na4', tones: '4', definition_cn: '女子人名用字' },
      cultural: {
        element: '火',
        connotation: '婀娜、柔美与舒展；常写姿态轻盈、线条优雅。',
        genderBias: 'feminine',
        localGloss: '婀娜、柔美、舒展',
      },
    },
    {
      char: '娜',
      role: 'given',
      entry: { pinyin: 'na4', tones: '4', definition_cn: '女子人名用字' },
      cultural: {
        element: '火',
        connotation: '婀娜、柔美与舒展；常写姿态轻盈、线条优雅。',
        genderBias: 'feminine',
        localGloss: '婀娜、柔美、舒展',
      },
    },
  ],
}

describe('grounded name summary prompts', () => {
  it('supplies parsed facts and prohibits unsupported biography', async () => {
    const { buildGroundedSummaryPrompt } = await import('../services/localInference')
    const prompt = buildGroundedSummaryPrompt(['书卷', '典雅'], result)

    expect(prompt).toContain('任务：只润色基础文稿，不介绍人物，不增加事实')
    expect(prompt).toContain('基础文稿：在“李明”中，“明”有明亮之意')
    expect(prompt).not.toContain('读音=míng')
    expect(prompt).toContain('禁止出现字号、人称、出生、籍贯、人物身份、生平')
  })

  it('rejects unsupported biographical claims from generated text', async () => {
    const { isGroundedSummary } = await import('../services/localInference')

    expect(isGroundedSummary('在“李明”中，“明”有明亮之意。单字为名使语意集中，姓与名衔接简洁，读来利落有力；这个字既清楚表达明亮，也让名字保有不张扬的分寸。名字整体清朗而有书卷气，也保留了端正雅致的分寸，读来舒展而协调。', result)).toBe(true)
    expect(isGroundedSummary('乐毅，字子渊，是春秋时期著名军事家。', result)).toBe(false)
    expect(isGroundedSummary('单于明，汉唐以来多有所指，意为光耀先贤，象征国家兴盛。', result)).toBe(false)
    expect(isGroundedSummary('结合具体字义生成一段100字左右的文雅姓名意境分析。', result)).toBe(false)
    expect(isGroundedSummary('读音：ming2。名字光明开阔，象征国家繁荣与民族昌盛，寄托美好愿景。', result)).toBe(false)
    expect(isGroundedSummary('李明字文彬，在书法方面有深厚造诣，他的作品典雅而富有诗意，深受读者喜爱。', result)).toBe(false)
    expect(isGroundedSummary('李明（明）字孔明，号卧龙，人称卧龙先生，以智慧和才华著称，被誉为一代名士。', result)).toBe(false)
    expect(isGroundedSummary('李明，明字，明亮、清楚而开朗，名字整体清朗舒展，也保留了温润雅致的分寸。', result)).toBe(false)
    expect(isGroundedSummary('在“李明”中，“明”有明亮之意。单字为名使语意集中，姓与名衔接简洁，读来利落有力；这个字既清楚表达明亮，也让名字保有不张扬的分寸。名字整体清朗而有书卷气，读来舒展而协调。', result)).toBe(true)
    expect(isGroundedSummary('在“李明”中，“明”有明亮之意。名字整体清朗舒展，也寄托待人坦荡、思路通达、步履从容的美好愿景，在平和之中保有坚定而清醒的力量。', result)).toBe(false)
  })
})

describe('deterministic name summaries', () => {
  it('uses naming meanings instead of dictionary etymology boilerplate', async () => {
    const { buildGroundedSummaryPrompt, buildLocalSummary } = await import('../services/localInference')
    const summary = buildLocalSummary(['书卷', '典雅'], liMinghua, 'model')
    const prompt = buildGroundedSummaryPrompt(['书卷', '典雅'], liMinghua)

    expect(summary).toContain('“明”有明亮、清楚、开朗之意')
    expect(summary).toContain('“华”则带有华美、光彩、繁盛的意味')
    expect(summary).not.toContain('会意')
    expect(summary).not.toContain('通过典故的化用')
    expect(summary).not.toContain('在此基础上进一步生发')
    expect(summary).not.toContain('点睛之笔')
    expect(prompt).toContain('“明”有明亮、清楚、开朗之意')
    expect(prompt).not.toContain('会意')
    expect(prompt).not.toContain('甲骨文')
  })

  it('mentions a literary source concretely rather than claiming generic allusion', async () => {
    const { buildLocalSummary } = await import('../services/localInference')
    const summary = buildLocalSummary(['书卷'], liMinghua, 'fallback')

    expect(summary).toContain('《大学》中的“明德”')
    expect(summary).toContain('(本地解析)')
  })

  it('gives single-character given names enough grounded material to rewrite', async () => {
    const { buildGroundedSummaryPrompt, buildLocalSummary } = await import('../services/localInference')
    const summary = buildLocalSummary(['坚毅'], yueYi, 'model')
    const prompt = buildGroundedSummaryPrompt(['坚毅'], yueYi)

    expect(summary).toContain('“毅”有意志坚定、果决刚健之意')
    expect(summary).not.toContain('殳')
    expect([...summary].length).toBeGreaterThanOrEqual(80)
    expect(prompt).toContain('不得在姓名后重复名字用字或添加“字”“号”')
  })

  it('grounds repeated-character given names without duplicating the same definition', async () => {
    const { buildGroundedSummaryPrompt, buildLocalSummary } = await import('../services/localInference')
    const summary = buildLocalSummary(['典雅', '书卷'], ouyangNana, 'model')
    const prompt = buildGroundedSummaryPrompt(['典雅', '书卷'], ouyangNana)

    expect(summary.match(/“娜”有婀娜、柔美、舒展之意/gu)).toHaveLength(1)
    expect(summary).toContain('叠字为名')
    expect(summary).toContain('节奏')
    expect([...summary].length).toBeGreaterThanOrEqual(80)
    expect(prompt).toContain('不要把同一个“娜”字解释两次')
  })

  it('does not present dictionary fragments as naming meanings', async () => {
    const { buildLocalSummary } = await import('../services/localInference')
    const fragmented: AnalyzedName = {
      original: '苏轼',
      chars: [
        { char: '苏', role: 'surname', entry: null, cultural: null },
        { char: '轼', role: 'given', entry: { pinyin: 'shi4', tones: '4', definition_cn: '《说文》一说本作“”' }, cultural: null },
      ],
    }

    const summary = buildLocalSummary(['新颖', '坚毅'], fragmented, 'model')

    expect(summary).toContain('没有可直接采用的名字字义')
    expect(summary).not.toContain('《说文》')
    expect([...summary].length).toBeGreaterThanOrEqual(80)
  })

  it('filters character-formation and measurement fragments from two-character names', async () => {
    const { buildLocalSummary } = await import('../services/localInference')
    const fragmented: AnalyzedName = {
      original: '王儿石',
      chars: [
        { char: '王', role: 'surname', entry: null, cultural: null },
        { char: '儿', role: 'given', entry: { pinyin: 'er2', tones: '2', definition_cn: '上面象小儿张口哭笑' }, cultural: null },
        { char: '石', role: 'given', entry: { pinyin: 'shi2', tones: '2', definition_cn: '十斗为一石' }, cultural: null },
      ],
    }

    const summary = buildLocalSummary(['自然', '深邃'], fragmented, 'model')

    expect(summary).toContain('没有可直接采用的名字字义')
    expect(summary).not.toContain('小儿张口')
    expect(summary).not.toContain('十斗为一石')
  })

  it('uses reviewed definitions instead of formation fragments for Zhang Suqin', async () => {
    const { buildGroundedSummaryPrompt, buildLocalSummary } = await import('../services/localInference')
    const zhangSuqin: AnalyzedName = {
      original: '张素琴',
      chars: [
        { char: '张', role: 'surname', entry: { pinyin: 'zhang1', tones: '1', definition_cn: '展开；伸展；扩大' }, cultural: null },
        { char: '素', role: 'given', entry: { pinyin: 'su4', tones: '4', definition_cn: '朴素无饰；本色；白色' }, cultural: null },
        { char: '琴', role: 'given', entry: { pinyin: 'qin2', tones: '2', definition_cn: '古琴；弦乐器的泛称' }, cultural: null },
      ],
    }

    const summary = buildLocalSummary(['新颖', '灵动'], zhangSuqin, 'model')
    const prompt = buildGroundedSummaryPrompt(['新颖', '灵动'], zhangSuqin)

    expect(summary).toContain('“素”有朴素无饰之意')
    expect(summary).toContain('“琴”则带有古琴的意味')
    expect(summary).not.toMatch(/下是|象乐器形|糸|琴身/u)
    expect(prompt).not.toMatch(/下是|象乐器形|糸|琴身/u)
    expect(prompt).not.toContain('没有可核实的名字字义')
  })

  it('gives repeated-character names a grounded structure when no meaning is usable', async () => {
    const { buildLocalSummary } = await import('../services/localInference')
    const fragmented: AnalyzedName = {
      original: '林玲玲',
      chars: [
        { char: '林', role: 'surname', entry: null, cultural: null },
        { char: '玲', role: 'given', entry: { pinyin: 'ling2', tones: '2', definition_cn: '形〉' }, cultural: null },
        { char: '玲', role: 'given', entry: { pinyin: 'ling2', tones: '2', definition_cn: '形〉' }, cultural: null },
      ],
    }

    const summary = buildLocalSummary(['新颖', '灵动'], fragmented, 'model')

    expect(summary).toContain('叠字结构')
    expect(summary).toContain('不补充未经核实的含义')
    expect(summary).not.toContain('形〉')
    expect([...summary].length).toBeGreaterThanOrEqual(80)
  })

  it('uses a naming meaning instead of fanqie notation for 一', async () => {
    const cultural = await import('../data/cultural.json')
    const { buildLocalSummary } = await import('../services/localInference')
    const wangYi: AnalyzedName = {
      original: '王一',
      chars: [
        { char: '王', role: 'surname', entry: null, cultural: null },
        { char: '一', role: 'given', entry: null, cultural: cultural.default['一'] as CulturalData },
      ],
    }

    const summary = buildLocalSummary(['灵动'], wangYi, 'model')

    expect(summary).toContain('“一”有专一、纯粹、万物之始之意')
    expect(summary).not.toContain('於悉切')
    expect(summary).not.toContain('益悉切')
  })

  it('keeps every cultural entry free of phonetic metadata in generated summaries', async () => {
    const cultural = await import('../data/cultural.json')
    const { buildLocalSummary } = await import('../services/localInference')
    const failures = []

    for (const [char, data] of Object.entries(cultural.default)) {
      const analyzed: AnalyzedName = {
        original: `王${char}`,
        chars: [
          { char: '王', role: 'surname', entry: null, cultural: null },
          { char, role: 'given', entry: null, cultural: data as CulturalData },
        ],
      }
      const summary = buildLocalSummary(['典雅'], analyzed, 'model')

      if (!summary.includes((data as CulturalData).localGloss ?? '')) failures.push(`${char}: missing gloss`)
      if (/(?:反切|切；名字里常取|俗.{0,4}字|古文.{0,4}字)/u.test(summary)) {
        failures.push(`${char}: ${summary}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps all cultural two-character combinations free of phonetic metadata', async () => {
    const cultural = await import('../data/cultural.json')
    const { buildLocalSummary } = await import('../services/localInference')
    const entries = Object.entries(cultural.default) as Array<[string, CulturalData]>
    const forbidden = /(?:反切|切；名字里常取|俗.{0,4}字|古文.{0,4}字|^(?:音.{1,4}|同.{1,4})之意)/u
    const failures = []

    for (const [firstChar, firstData] of entries) {
      for (const [secondChar, secondData] of entries) {
        const analyzed: AnalyzedName = {
          original: `王${firstChar}${secondChar}`,
          chars: [
            { char: '王', role: 'surname', entry: null, cultural: null },
            { char: firstChar, role: 'given', entry: null, cultural: firstData },
            { char: secondChar, role: 'given', entry: null, cultural: secondData },
          ],
        }
        const summary = buildLocalSummary(['典雅', '自然'], analyzed, 'model')

        if (forbidden.test(summary)) failures.push(`${firstChar}${secondChar}: ${summary}`)
      }
    }
    expect(failures).toEqual([])
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

    expect(analysis.labelSource).toBe('fallback')
    expect(analysis.summarySource).toBe('fallback')
    expect(analysis.labels.every(label => ['书卷', '宏伟', '豪迈', '恬静', '典雅', '新颖', '灵动', '坚毅', '自然', '深邃'].includes(label))).toBe(true)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances.every(worker => worker.terminated)).toBe(true)
  })

  it('marks label provenance as none when model abstains and rules do not match', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    vi.stubGlobal('Worker', class extends FakeWorker {
      constructor() {
        super()
        this.respondToInfer = false
      }
    })
    const unmatched: AnalyzedName = {
      original: '李仉',
      chars: [
        { char: '李', role: 'surname', entry: null, cultural: null },
        { char: '仉', role: 'given', entry: null, cultural: null },
      ],
    }

    const analysisPromise = runLocalAiAnalysis(unmatched)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(analysis.labelSource).toBe('none')
    expect(analysis.labels).toEqual([])
    expect(analysis.summarySource).toBe('fallback')
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

    expect(resolved.every(analysis => analysis.labelSource === 'fallback')).toBe(true)
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
    expect(firstAnalysis.labelSource).toBe('fallback')
    expect(thirdAnalysis.labelSource).toBe('fallback')
    expect(FakeWorker.instances).toHaveLength(4)
  })

  it('aborts and retries timed-out Ollama requests', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    const expectation = expect(analysisPromise).rejects.toMatchObject({
      name: 'InferenceError',
      code: 'deadline-exceeded',
      message: 'AI 深度分析超时，请重试。',
    })
    await vi.runAllTimersAsync()
    await expectation
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(call => call[1]?.signal?.aborted)).toBe(true)
  })

  it('tries equivalent Ollama addresses sequentially on the standard port', async () => {
    let resolveFirst!: (response: Response) => void
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve }))
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: '在“李明”中，“明”有明亮之意。单字为名使语意集中，姓与名衔接简洁，读来利落有力；这个字既清楚表达明亮，也让名字保有不张扬的分寸。名字整体清朗而有书卷气，读来舒展而协调。' }),
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
    expect(request.prompt).toContain('任务：只润色基础文稿，不介绍人物，不增加事实')
    expect(request.prompt).toContain('基础文稿：在“李明”中，“明”有明亮之意')

    resolveFirst({ ok: false } as Response)
    await vi.advanceTimersByTimeAsync(250)
    const analysis = await analysisPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:11434/api/generate')
    expect(analysis.summary).toContain('在“李明”中')
    expect(analysis.summarySource).toBe('ollama')
  })

  it('reports a grounded native Qwen summary independently from ONNX labels', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    const nativeSummary = '在“李明华”中，“明”有明亮、清楚、开朗之意，“华”则带有华美、光彩、繁盛的意味。两字相连，整体端正雅致，也保留了清朗而有书卷气的分寸；文化联想上，可联系《大学》中的“明德”，使名字意涵更有层次。'
    invokeMock.mockImplementation((command: string) => {
      if (command === 'check_model_exists') return Promise.resolve(true)
      if (command === 'generate_internal_summary') return Promise.resolve(nativeSummary)
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(liMinghua)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(analysis.summary).toBe(nativeSummary)
    expect(analysis.summarySource).toBe('native')
    expect(analysis.generationStatus).toBe('complete')
  })

  it('retries a rejected native output with corrective context', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    const rejected = '李明华，字华，出生于书香门第。'
    const corrected = '在“李明华”中，“明”有明亮、清楚、开朗之意，“华”则带有华美、光彩、繁盛的意味。名字中的两个用字彼此映照，整体清朗而有书卷气，也保留了端正雅致的分寸；文化联想上，可联系《大学》中的“明德”，使名字意涵更有层次。'
    const contexts: string[] = []
    invokeMock.mockImplementation((command: string, args?: { context?: string }) => {
      if (command === 'check_model_exists') return Promise.resolve(true)
      if (command === 'generate_internal_summary') {
        contexts.push(args?.context ?? '')
        return Promise.resolve(contexts.length === 1 ? rejected : corrected)
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(liMinghua)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(analysis.summary).toBe(corrected)
    expect(analysis.summarySource).toBe('native')
    expect(analysis.generationStatus).toBe('complete')
    expect(contexts).toHaveLength(2)
    expect(contexts[1]).not.toContain(rejected)
    expect(contexts[1]).toContain('上一次输出未通过检查，拒绝代码')
    expect(contexts[1]).toContain('虚构了字号或人物身份')
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
    const rejected = analysisPromise.catch(error => error)
    await vi.runAllTimersAsync()
    await expect(rejected).resolves.toMatchObject({
      name: 'InferenceError',
      code: 'deadline-exceeded',
      message: 'AI 深度分析超时，请重试。',
    })

    expect(invokeMock.mock.calls.filter(call => call[0] === 'generate_internal_summary')).toHaveLength(3)
    expect(invokeMock.mock.calls.filter(call => call[0] === 'cancel_internal_summary')).toHaveLength(3)
  })

  it('does not overlap an uncancellable timed-out native model check', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    invokeMock.mockImplementation((command: string) => {
      if (command === 'check_model_exists') return new Promise(() => {})
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    const rejected = analysisPromise.catch(error => error)
    await vi.runAllTimersAsync()

    expect(invokeMock.mock.calls.filter(call => call[0] === 'check_model_exists')).toHaveLength(1)
    await expect(rejected).resolves.toMatchObject({
      name: 'InferenceError',
      code: 'native-timeout',
      message: '原生 Qwen 生成超时，请重试。',
    })
  })

  it('degrades safely after native runtime failures', async () => {
    ;(window as TauriWindow).__TAURI_INTERNALS__ = {}
    invokeMock.mockImplementation((command: string) => {
      if (command === 'check_model_exists') return Promise.resolve(true)
      if (command === 'generate_internal_summary') return Promise.reject(new Error('Failed to load model'))
      return Promise.reject(new Error(`Unexpected command: ${command}`))
    })
    const { runLocalAiAnalysis } = await import('../services/localInference')

    const analysisPromise = runLocalAiAnalysis(result)
    await vi.runAllTimersAsync()
    const analysis = await analysisPromise

    expect(analysis.summarySource).toBe('fallback')
    expect(analysis.generationStatus).toBe('degraded')
    expect(analysis.summary).toContain('本地解析')
    expect(invokeMock.mock.calls.filter(call => call[0] === 'generate_internal_summary')).toHaveLength(3)
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
    const rejected = analysisPromise.catch(error => error)
    await vi.runAllTimersAsync()
    await expect(rejected).resolves.toMatchObject({
      name: 'InferenceError',
      code: 'native-timeout',
      message: '原生 Qwen 生成超时，请重试。',
    })

    expect(invokeMock.mock.calls.filter(call => call[0] === 'generate_internal_summary')).toHaveLength(1)
    expect(invokeMock.mock.calls.filter(call => call[0] === 'cancel_internal_summary')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
