import { describe, expect, it } from 'vitest'
import chars from '../../public/data/chars.json'
import surnames from '../../public/data/surnames.json'
import compoundSurnamePinyin from '../data/compoundSurnamePinyin.json'
import cultural from '../data/cultural.json'
import dictionarySupplements from '../data/ccCedictDefinitionSupplements.json'
import { getCulturalData, isUsableCulturalData } from '../data/cultural'
import { formatPinyin, hasMeaningfulDefinition } from '../services/nameAnalyzer'
import type { CharEntry, CulturalData } from '../types'

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

  it('provides modern definitions for every reviewed cultural character', () => {
    const missing = Object.keys(cultural).filter(
      char => !hasMeaningfulDefinition(charDict[char]?.definition_cn),
    )

    expect(missing).toEqual([])
  })

  it('keeps every supplemental definition traceable to reviewed CC-CEDICT glosses', () => {
    expect(dictionarySupplements.source).toMatchObject({
      name: 'CC-CEDICT',
      release: '2026-08-02 07:59:46 GMT',
      sha256: '700ca1acb9729385bb1e86061e2b8478be7755b85d8854cd0e0a81cd11316381',
      license: 'CC BY-SA 4.0',
    })

    for (const [char, supplement] of Object.entries(dictionarySupplements.entries)) {
      expect(supplement.reviewed).toBe(true)
      expect(supplement.raw).toContain(` ${char} [`)
      expect(supplement.glosses.length).toBeGreaterThan(0)
      for (const gloss of supplement.glosses) expect(supplement.raw).toContain(gloss)
      expect(charDict[char]?.definition_cn).toBe(supplement.definitionCn)
    }
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
    expect(cultural['毅'].localGloss).toBe('意志坚定、果决刚健')
  })

  it('keeps every cultural meaning free of pronunciation and variant metadata', () => {
    const entries = Object.entries(cultural) as Array<[string, CulturalData]>
    const failures = []

    expect(entries.length).toBeGreaterThanOrEqual(250)
    for (const [char, data] of entries) {
      if (!isUsableCulturalData(data)) failures.push(`${char}: ${data.localGloss}`)
      expect(getCulturalData(char)).toEqual(data)
    }
    expect(failures).toEqual([])
  })

  it('quarantines Kangxi pronunciation metadata at the runtime boundary', () => {
    expect(cultural).not.toHaveProperty('風')
    expect(cultural).not.toHaveProperty('桥')
    expect(cultural).not.toHaveProperty('遷')
    expect(getCulturalData('風')).toBeNull()
    expect(getCulturalData('桥')).toBeNull()
    expect(getCulturalData('遷')).toBeNull()
    expect(isUsableCulturalData({
      localGloss: '方戎切方馮切',
      connotation: '方戎切方馮切；名字里常取德性、安稳的感觉。',
    })).toBe(false)
    expect(isUsableCulturalData({
      localGloss: '俗遷字',
      connotation: '俗遷字；名字里常取德性、安稳的感觉。',
    })).toBe(false)
    expect(isUsableCulturalData({
      localGloss: '专一、纯粹、万物之始',
      connotation: '专一、纯粹，也有万物之始的意味。',
    })).toBe(true)
  })
})
