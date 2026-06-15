import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../data/cultural', () => ({
  getCulturalData: vi.fn(() => null),
}))

const charsJson = {
  李: ['li3', '李', 'the surname Li'],
  明: ['ming2', null, 'bright'],
  华: ['hua2', null, 'magnificent'],
  欧: ['ou1', '歐', 'Europe'],
  阳: ['yang2', '陽', 'sun'],
}

const surnamesJson = {
  李: '',
  欧: '',
  阳: '',
}

vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url === '/data/chars.json') {
    return new Response(JSON.stringify(charsJson), { status: 200 })
  }
  if (url === '/data/surnames.json') {
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

    expect(result.chars.map(char => char.role)).toEqual(['surname', 'given', 'given'])
  })

  it('prefers a compound surname when the first two characters match', async () => {
    const { analyzeName } = await import('../services/nameAnalyzer')
    const result = await analyzeName('欧阳明华')

    expect(result.chars.map(char => char.role)).toEqual(['surname', 'surname', 'given', 'given'])
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
})
