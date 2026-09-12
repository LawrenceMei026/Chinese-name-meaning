import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NumerologyPanel from '../components/NumerologyPanel.vue'
import { buildNameNumerology } from '../services/nameNumerology'

describe('NumerologyPanel', () => {
  it('渲染五格与三才结果', () => {
    const numerology = buildNameNumerology([
      { char: '张', role: 'surname', stroke: 11 },
      { char: '适', role: 'given', stroke: 18 },
      { char: '抡', role: 'given', stroke: 12 },
    ])
    const wrapper = mount(NumerologyPanel, { props: { numerology } })

    expect(numerology.supported).toBe(true)
    expect(wrapper.text()).toContain('姓名数理')
    expect(wrapper.text()).toContain('天格')
    expect(wrapper.text()).toContain('总格')
    expect(wrapper.text()).toContain('41')
    expect(wrapper.text()).toContain('三才配置')
    expect(wrapper.text()).toContain('木水水')
    expect(wrapper.text()).toContain('大吉')
    expect(wrapper.text()).toContain('仅供文化参考')
  })

  it('笔画缺失时展示降级说明', () => {
    const numerology = buildNameNumerology([
      { char: '李', role: 'surname', stroke: 7 },
      { char: '琰', role: 'given', stroke: -1 },
    ])
    const wrapper = mount(NumerologyPanel, { props: { numerology } })

    expect(numerology.supported).toBe(false)
    expect(wrapper.text()).toContain('琰')
    expect(wrapper.text()).toContain('暂缺姓名学笔画数据')
  })
})
