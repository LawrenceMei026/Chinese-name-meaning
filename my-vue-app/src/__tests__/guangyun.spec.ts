import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import CharacterCard from '../components/CharacterCard.vue'
import guangyunData from '../../public/data/guangyun.json'
import { getGuangyunEntries, loadGuangyunData } from '../data/guangyun'
import type { AnalyzedChar } from '../types'

const feng: AnalyzedChar = {
  char: '风',
  role: 'given',
  entry: { pinyin: 'feng1', tones: '1', definition_cn: '空气流动的现象' },
  cultural: null,
}

describe('Guangyun historical data', () => {
  it('pins source provenance and keeps broad offline coverage', () => {
    expect(guangyunData.source).toMatchObject({
      commit: '21585e22c8a730ca2fd175112f4d18e16d5ce578',
      sha256: 'f2b66197355d4fbff0776ab34e4aece817363b00446fbcf08e2f1677a7ac0c5f',
      license: 'CC0-1.0',
    })
    expect(guangyunData.sourceRows).toBe(25_336)
    expect(Object.keys(guangyunData.entries).length).toBeGreaterThanOrEqual(11_000)
  })

  it('maps a reviewed simplified lookup to its source headword', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => guangyunData }))
    await loadGuangyunData()
    const entries = getGuangyunEntries('风')

    expect(entries.length).toBeGreaterThan(0)
    expect(entries).toContainEqual(expect.objectContaining({
      headword: '風',
      fanqie: '方戎',
      rhyme: '東',
    }))
  })

  it('keeps historical data hidden unless explicitly enabled', () => {
    const entries = getGuangyunEntries('风')
    const hidden = mount(CharacterCard, { props: { data: feng, showGuangyun: false } })
    const visible = mount(CharacterCard, { props: { data: feng, guangyunEntries: entries, showGuangyun: true } })

    expect(hidden.find('.guangyun-section').exists()).toBe(false)
    expect(visible.find('.guangyun-section').text()).toContain('《广韵》切音与古义')
    expect(visible.find('.guangyun-section').text()).toContain('方戎切')
    expect(visible.find('.guangyun-section').text()).toContain('教也')
  })
})
