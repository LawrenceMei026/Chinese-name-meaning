import { beforeEach, describe, expect, it, vi } from 'vitest'
import charsJson from '../../public/data/chars.json'
import surnamesJson from '../../public/data/surnames.json'

vi.mock('../data/cultural', () => ({
  getCulturalData: vi.fn<(char: string) => null>(() => null),
}))

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = input.toString()
  if (url.endsWith('/data/chars.json')) return Response.json(charsJson)
  if (url.endsWith('/data/surnames.json')) return Response.json(surnamesJson)
  return new Response('not found', { status: 404 })
}))

describe('production name data quality', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it.each([
    ['乐明', 'yue4'],
    ['翟明', 'zhai2'],
    ['华明', 'hua4'],
    ['覃明', 'tan2'],
    ['隗明', 'wei3'],
  ])('uses the surname reading for %s', async (name, expectedPinyin) => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName(name)

    expect(result.chars[0]?.role).toBe('surname')
    expect(result.chars[0]?.entry?.pinyin).toBe(expectedPinyin)
  })

  it.each([
    ['单于明', ['chan2', 'yu2']],
    ['尉迟明', ['yu4', 'chi2']],
    ['长孙明', ['zhang3', 'sun1']],
    ['乐正明', ['yue4', 'zheng4']],
  ])('uses the explicit compound-surname reading for %s', async (name, expectedPinyin) => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName(name)

    expect(result.chars.slice(0, 2).map(char => char.role)).toEqual(['surname', 'surname'])
    expect(result.chars.slice(0, 2).map(char => char.entry?.pinyin)).toEqual(expectedPinyin)
  })

  it('replaces a punctuation-only surname definition with useful context', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName('李明华')

    expect(result.chars[0]?.entry?.definition_cn).toBe('姓氏用字。')
  })
})
