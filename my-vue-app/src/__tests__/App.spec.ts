import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../App.vue'
import packageJson from '../../package.json'
import type { AnalyzedName, AiAnalysisResult } from '../types'

vi.mock('../services/nameAnalyzer', () => ({
  analyzeName: vi.fn<(input: string) => Promise<AnalyzedName>>(),
  preloadDictionary: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('../services/localInference', () => ({
  runLocalAiAnalysis: vi.fn<(
    result: AnalyzedName,
    options?: { signal?: AbortSignal },
  ) => Promise<AiAnalysisResult>>().mockResolvedValue({
    labels: ['书卷'],
    summary: '本地回退结果。',
    loadedFromCache: false,
    source: 'fallback',
  }),
  checkNativeModel: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  checkSystemMemory: vi.fn<() => Promise<number>>().mockResolvedValue(16),
  getModelDirectory: vi.fn<() => Promise<string>>().mockResolvedValue('D:\\ChineseNameModels'),
  setModelDirectory: vi.fn<(directory: string) => Promise<string>>().mockImplementation(async directory => directory),
  startModelDownload: vi.fn<() => Promise<string>>().mockResolvedValue('D:\\ChineseNameModels\\qwen2.5-0.5b-instruct.gguf'),
  formatModelDownloadError: vi.fn<(error: unknown) => string>(() => '模型下载失败'),
}))

const sampleResult: AnalyzedName = {
  original: '李明华',
  chars: [
    { char: '李', role: 'surname', entry: null, cultural: null },
    { char: '明', role: 'given', entry: null, cultural: null },
    { char: '华', role: 'given', entry: null, cultural: null },
  ],
}

const sampleAiResult: AiAnalysisResult = {
  labels: ['书卷'],
  summary: '本地回退结果。',
  loadedFromCache: false,
  source: 'fallback',
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the analyzer shell', () => {
    const wrapper = mount(App)

    expect(wrapper.text()).toContain('汉字姓名解析')
    expect(wrapper.text()).toContain('输入一个中文姓名，探索每个汉字背后的含义、文化内涵与历史渊源。')
    expect(wrapper.find('label.sr-only').text()).toBe('请输入中文姓名')
    expect(wrapper.find('p.field-help').text()).toContain('支持 2-4 个汉字姓名')
    expect(wrapper.find('section.empty-state').text()).toContain('等待解析')
    expect(wrapper.find('input#name-input').attributes('aria-invalid')).toBe('false')
    expect(wrapper.find('input#show-guangyun').exists()).toBe(true)
    expect((wrapper.find('input#show-guangyun').element as HTMLInputElement).checked).toBe(false)
  })

  it('uses the package version in feedback diagnostics', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = mount(App)

    await wrapper.find('button.feedback-link').trigger('click')

    const feedbackUrl = new URL(String(openSpy.mock.calls[0]?.[0]))
    expect(feedbackUrl.searchParams.get('body')).toContain(`- 应用版本: ${packageJson.version}`)
    openSpy.mockRestore()
  })

  it('hydrates history from localStorage and renders entries', async () => {
    localStorage.setItem('analysis-history-v1', JSON.stringify([
      {
        id: 'history-1',
        input: '李明华',
        createdAt: 1710000000000,
        result: sampleResult,
      },
    ]))

    const wrapper = mount(App)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('section.history').exists()).toBe(true)
    expect(wrapper.find('.history-name').text()).toBe('李明华')
  })

  it('saves a new history entry after successful analysis', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    vi.mocked(analyzeName).mockResolvedValue(sampleResult)

    const wrapper = mount(App)
    await wrapper.find('input#name-input').setValue('李明华')
    await wrapper.find('form.search-form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    const saved = JSON.parse(localStorage.getItem('analysis-history-v1') ?? '[]')
    expect(saved).toHaveLength(1)
    expect(saved[0].input).toBe('李明华')
    expect(saved[0].result.original).toBe('李明华')
    expect(wrapper.find('section.history').text()).toContain('李明华')
  })

  it('restores a selected history entry', async () => {
    localStorage.setItem('analysis-history-v1', JSON.stringify([
      {
        id: 'history-1',
        input: '李明华',
        createdAt: 1710000000000,
        result: sampleResult,
        aiResult: sampleAiResult,
      },
    ]))

    const wrapper = mount(App)
    await wrapper.vm.$nextTick()

    await wrapper.find('.history-button').trigger('click')

    expect((wrapper.find('input#name-input').element as HTMLInputElement).value).toBe('李明华')
    expect(wrapper.find('.result-name').text()).toBe('李明华')
    expect(wrapper.find('.result-meta').text()).toContain('3 个字')
    expect(wrapper.find('.ai-panel').exists()).toBe(true)
    expect(wrapper.find('.ai-summary').text()).toContain('本地回退结果')
  })

  it('persists the AI result back into the active history entry', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const { runLocalAiAnalysis } = await import('../services/localInference')
    vi.mocked(analyzeName).mockResolvedValue(sampleResult)
    vi.mocked(runLocalAiAnalysis).mockResolvedValue(sampleAiResult)

    const wrapper = mount(App)
    await wrapper.find('input#name-input').setValue('李明华')
    await wrapper.find('form.search-form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    await wrapper.find('.history-button').trigger('click')
    await wrapper.find('button.ai-btn').trigger('click')
    await wrapper.vm.$nextTick()

    const saved = JSON.parse(localStorage.getItem('analysis-history-v1') ?? '[]')
    expect(saved[0].aiResult.summary).toBe('本地回退结果。')
    expect(wrapper.find('.ai-panel').exists()).toBe(true)
  })

  it('shows native Qwen quality errors without replacing their recovery guidance', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    vi.mocked(runLocalAiAnalysis).mockRejectedValue(
      new Error('原生 Qwen 输出未通过事实检查，请重新分析。'),
    )
    localStorage.setItem('analysis-history-v1', JSON.stringify([{
      id: 'history-1',
      input: '欧阳娜娜',
      createdAt: 1710000000000,
      result: { ...sampleResult, original: '欧阳娜娜' },
    }]))
    const wrapper = mount(App)
    await wrapper.vm.$nextTick()
    await wrapper.find('.history-button').trigger('click')

    await wrapper.find('button.ai-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.ai-error').text()).toBe('原生 Qwen 输出未通过事实检查，请重新分析。')
  })

  it('shows native Qwen runtime errors without replacing their recovery guidance', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    vi.mocked(runLocalAiAnalysis).mockRejectedValue(
      new Error('原生 Qwen 运行失败，请重试。'),
    )
    localStorage.setItem('analysis-history-v1', JSON.stringify([{
      id: 'history-1',
      input: '李明华',
      createdAt: 1710000000000,
      result: sampleResult,
    }]))
    const wrapper = mount(App)
    await wrapper.vm.$nextTick()
    await wrapper.find('.history-button').trigger('click')

    await wrapper.find('button.ai-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.ai-error').text()).toBe('原生 Qwen 运行失败，请重试。')
  })

  it('cancels an in-flight AI analysis from the same button', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    vi.mocked(runLocalAiAnalysis).mockImplementation((_result, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    }))
    localStorage.setItem('analysis-history-v1', JSON.stringify([{
      id: 'history-1',
      input: '李明华',
      createdAt: 1710000000000,
      result: sampleResult,
    }]))
    const wrapper = mount(App)
    await wrapper.vm.$nextTick()
    await wrapper.find('.history-button').trigger('click')

    await wrapper.find('button.ai-btn').trigger('click')
    expect(wrapper.find('button.ai-btn').text()).toContain('取消分析')
    await wrapper.find('button.ai-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('button.ai-btn').text()).toContain('AI 深度分析')
    expect(wrapper.find('.ai-error').exists()).toBe(false)
  })

  it('cancels an in-flight AI analysis when unmounted', async () => {
    const { runLocalAiAnalysis } = await import('../services/localInference')
    let capturedSignal: AbortSignal | undefined
    vi.mocked(runLocalAiAnalysis).mockImplementation((_result, options) => {
      capturedSignal = options?.signal
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
      })
    })
    localStorage.setItem('analysis-history-v1', JSON.stringify([{
      id: 'history-1',
      input: '李明华',
      createdAt: 1710000000000,
      result: sampleResult,
    }]))
    const wrapper = mount(App)
    await wrapper.vm.$nextTick()
    await wrapper.find('.history-button').trigger('click')
    await wrapper.find('button.ai-btn').trigger('click')

    wrapper.unmount()

    expect(capturedSignal?.aborted).toBe(true)
  })

  it('ignores malformed history data', async () => {
    localStorage.setItem('analysis-history-v1', '{bad json')

    const wrapper = mount(App)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('section.history').exists()).toBe(false)
  })
})
