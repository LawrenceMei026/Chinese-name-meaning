import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../App.vue'

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

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
