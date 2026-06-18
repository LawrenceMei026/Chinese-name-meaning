import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../data/cultural', () => ({
  getCulturalData: vi.fn(() => null),
}))

const charsJson = {
  李: { pinyin: 'li3', tones: '3', definition_cn: 'the surname Li' },
  明: { pinyin: 'ming2', tones: '2', definition_cn: 'bright' },
  华: { pinyin: 'hua2', tones: '2', definition_cn: 'magnificent' },
  欧: { pinyin: 'ou1', tones: '1', definition_cn: 'Europe' },
  阳: { pinyin: 'yang2', tones: '2', definition_cn: 'sun' },
  刘: { pinyin: 'liu2', tones: '2', definition_cn: 'surname Liu' },
  归: { pinyin: 'gui1', tones: '1', definition_cn: 'return' },
  走: { pinyin: 'zou3', tones: '3', definition_cn: 'walk' },
}

const surnamesJson = {
  李: '',
  欧: '',
  阳: '',
}

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString()
  if (url.endsWith('/data/chars.json')) {
    return new Response(JSON.stringify(charsJson), { status: 200 })
  }
  if (url.endsWith('/data/surnames.json')) {
    return new Response(JSON.stringify(surnamesJson), { status: 200 })
  }
  return new Response('not found', { status: 404 })
}))

describe('analyzeName', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('marks a single-character surname correctly', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName('李明华')

    expect(result.original).toBe('李明华')
    expect(result.chars.map(char => char.role)).toEqual(['surname', 'given', 'given'])
  })

  it('trims the original input before returning it', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName('  李明华  ')

    expect(result.original).toBe('李明华')
  })

  it('prefers a compound surname when the first two characters match', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName('欧阳明华')

    expect(result.chars.map(char => char.role)).toEqual(['surname', 'surname', 'given', 'given'])
  })

  it('falls back to given-name roles when the surname is unknown', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName('王小明')

    expect(result.chars.map(char => char.role)).toEqual(['given', 'given', 'given'])
  })
})

describe('formatPinyin', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('normalizes whitespace between syllables', async () => {
    const { formatPinyin } = await import('../services/nameAnalyzer')

    expect(formatPinyin('  zhong1   guo2  ')).toBe('zhōng guó')
  })

  it('keeps uppercase syllables uppercase', async () => {
    const { formatPinyin } = await import('../services/nameAnalyzer')

    expect(formatPinyin('ZHONG1')).toBe('ZHŌNG')
  })

  it('handles ü syllables and neutral tones', async () => {
    const { formatPinyin } = await import('../services/nameAnalyzer')

    expect(formatPinyin('nv3 er2 ma')).toBe('nǚ ér ma')
    expect(formatPinyin('NV3 ER2 MA')).toBe('NǙ ÉR MA')
  })

  it('places tones on the correct vowel clusters', async () => {
    const { formatPinyin } = await import('../services/nameAnalyzer')

    expect(formatPinyin('liu2 gui1 zou3')).toBe('liú guī zǒu')
  })
})
