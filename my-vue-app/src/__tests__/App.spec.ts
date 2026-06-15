import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../App.vue'
import type { AnalyzedName, AiAnalysisResult } from '../types'

vi.mock('../services/nameAnalyzer', () => ({
  analyzeName: vi.fn(),
  preloadDictionary: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/localInference', () => ({
  runLocalAiAnalysis: vi.fn().mockResolvedValue({
    labels: ['文雅'],
    summary: '本地回退结果。',
    loadedFromCache: false,
    source: 'fallback',
  }),
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
  labels: ['文雅'],
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
    expect(wrapper.find('label.sr-only').text()).toBe('请输入中文姓名或拼音')
    expect(wrapper.find('p.field-help').text()).toContain('支持 2-3 个汉字姓名')
    expect(wrapper.find('section.empty-state').text()).toContain('等待解析')
    expect(wrapper.find('input#name-input').attributes('aria-invalid')).toBe('false')
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

  it('ignores malformed history data', async () => {
    localStorage.setItem('analysis-history-v1', '{bad json')

    const wrapper = mount(App)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('section.history').exists()).toBe(false)
  })
})
