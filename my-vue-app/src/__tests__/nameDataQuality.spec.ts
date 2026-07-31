import { describe, expect, it } from 'vitest'
import chars from '../../public/data/chars.json'
import surnames from '../../public/data/surnames.json'
import compoundSurnamePinyin from '../data/compoundSurnamePinyin.json'
import cultural from '../data/cultural.json'
import { formatPinyin, hasMeaningfulDefinition } from '../services/nameAnalyzer'
import type { CharEntry } from '../types'

const charDict = chars as Record<string, CharEntry>
const surnameDict = surnames as Record<string, string>

describe('production name data quality', () => {
  it('keeps every surname connected to a dictionary character and a reading', () => {
    for (const [surname, pinyin] of Object.entries(surnameDict)) {
      expect([...surname]).toHaveLength(1)
      expect(charDict[surname]).toBeDefined()
      expect(pinyin).toMatch(/[1-5]$/)
    }
  })

  it('contains real surname-context readings that differ from ordinary readings', () => {
    const contextualReadings = Object.entries(surnameDict).filter(
      ([surname, pinyin]) => charDict[surname]?.pinyin !== pinyin,
    )

    expect(contextualReadings.length).toBeGreaterThanOrEqual(13)
    expect(Object.fromEntries(contextualReadings)).toMatchObject({
      乐: 'yue4', 翟: 'zhai2', 华: 'hua4', 覃: 'tan2', 隗: 'wei3',
    })
  })

  it('stores only complete contextual readings for special compound surnames', () => {
    for (const [surname, pinyin] of Object.entries(compoundSurnamePinyin)) {
      expect([...surname]).toHaveLength(2)
      expect(pinyin.split(/\s+/)).toHaveLength(2)
      expect(formatPinyin(pinyin)).not.toContain(':')
    }
    expect(compoundSurnamePinyin).toMatchObject({
      万俟: 'mo4 qi2', 单于: 'chan2 yu2', 尉迟: 'yu4 chi2', 长孙: 'zhang3 sun1', 乐正: 'yue4 zheng4',
    })
  })

  it('recognizes and contains dirty source definitions for runtime sanitation', () => {
    const dirty = Object.values(charDict).filter(entry => !hasMeaningfulDefinition(entry.definition_cn))

    expect(dirty.length).toBeGreaterThanOrEqual(1_000)
    expect(hasMeaningfulDefinition(charDict['李']?.definition_cn)).toBe(false)
  })

  it('formats every source u-colon reading without leaking source notation', () => {
    const colonReadings = Object.values(charDict).filter(entry => /u:/i.test(entry.pinyin))

    expect(colonReadings.length).toBeGreaterThanOrEqual(38)
    for (const entry of colonReadings) expect(formatPinyin(entry.pinyin)).not.toContain(':')
  })

  it('keeps corrected literary references source-specific and textually honest', () => {
    expect(cultural['馨'].literaryRef).toContain('《尚书·君陈》')
    expect(cultural['馨'].literaryRef).not.toContain('《尚书·酒诰》')
    expect(cultural['蘅'].literaryRef).toContain('并非同字')
    expect(cultural['瑾'].literaryRef).toContain('《楚辞·九章·怀沙》')
    expect(cultural['瑜'].literaryRef).toContain('《礼记·聘义》')
  })
})
