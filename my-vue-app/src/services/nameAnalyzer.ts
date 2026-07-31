import type { AnalyzedChar, AnalyzedName, CharEntry } from '../types'
import { getCulturalData } from '../data/cultural'
import compoundSurnamePinyin from '../data/compoundSurnamePinyin.json'

type RawDict = Record<string, CharEntry>
type SurnameDict = Record<string, string>

let charDict: RawDict | null = null
let surnameDict: SurnameDict | null = null
let loadPromise: Promise<void> | null = null

const COMMON_COMPOUND_SURNAMES = new Set([
  '欧阳', '司徒', '上官', '诸葛', '司马', '夏侯', '令狐', '皇甫', '宇文', '慕容',
  '尉迟', '长孙', '公孙', '东郭', '南宫', '闾丘', '子车', '百里', '梁丘', '东门',
  '西门', '呼延', '公羊', '轩辕', '濮阳', '单于', '申屠', '仲孙', '钟离', '东里',
  '谷梁', '拓跋', '夹谷', '段干', '漆雕', '乐正', '壤驷', '公良', '漆周', '东野',
  '宰父', '端木', '巫马', '公西', '颛孙', '壤丘', '微生', '羊舌', '万俟', '闻人',
  '东方', '赫连', '澹台', '公冶', '宗政', '淳于', '太叔', '鲜于', '司空', '司寇',
  '亓官', '左丘', '南门', '归海', '第五',
])

function baseUrl() {
  const locationHref = typeof window !== 'undefined' ? window.location.href : 'http://localhost/'
  return new URL(import.meta.env.BASE_URL, locationHref).toString()
}

function dataUrl(path: string) {
  return new URL(path, baseUrl()).toString()
}

async function loadData() {
  if (charDict && surnameDict) return
  if (!loadPromise) {
    loadPromise = Promise.all([
      fetch(dataUrl('data/chars.json')),
      fetch(dataUrl('data/surnames.json')),
    ])
      .then(async ([charsRes, surnamesRes]) => {
        if (!charsRes.ok || !surnamesRes.ok) {
          throw new Error('Dictionary data failed to load')
        }

        charDict = await charsRes.json() as RawDict
        surnameDict = await surnamesRes.json() as SurnameDict
      })
      .finally(() => {
        loadPromise = null
      })
  }

  await loadPromise
}

function lookupChar(char: string): CharEntry | null {
  if (!charDict) return null
  return charDict[char] ?? null
}

function toneString(pinyin: string): string {
  const tone = toneFromPinyin(pinyin)
  return tone ? String(tone) : '0'
}

function withPinyin(entry: CharEntry | null, pinyin: string | undefined): CharEntry | null {
  if (!entry || !pinyin) return entry
  return { ...entry, pinyin, tones: toneString(pinyin) }
}

export function hasMeaningfulDefinition(definition: string | undefined): boolean {
  const trimmed = definition?.trim()
  return Boolean(
    trimmed
    && !/^[()（）,，。;；?？\s]+$/.test(trimmed)
    && !/^(?:暂无中文释义|义未详)$/u.test(trimmed),
  )
}

function sanitizeEntry(entry: CharEntry | null, role: 'surname' | 'given'): CharEntry | null {
  if (!entry || hasMeaningfulDefinition(entry.definition_cn)) return entry
  return {
    ...entry,
    definition_cn: role === 'surname' ? '姓氏用字' : '',
  }
}

function toneFromPinyin(syllable: string): number {
  const match = syllable.match(/(\d)$/)
  return match ? parseInt(match[1]!) : 0
}

const toneMap: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à', 'a'],
  e: ['ē', 'é', 'ě', 'è', 'e'],
  i: ['ī', 'í', 'ǐ', 'ì', 'i'],
  o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
  u: ['ū', 'ú', 'ǔ', 'ù', 'u'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
}

function vowelAt(base: string, index: number): string | null {
  const char = base[index]
  if (!char) return null
  const lowered = char.toLowerCase()
  if (/[aeoiuvü]/.test(lowered)) return lowered === 'v' ? 'ü' : lowered
  return null
}

function toneVowel(vowel: string, tone: number): string {
  return toneMap[vowel]?.[tone - 1] ?? vowel
}

function isUppercaseLetter(char: string): boolean {
  return char === char.toUpperCase() && char !== char.toLowerCase()
}

function applyTone(baseChar: string, tone: number): string {
  const normalized = baseChar.toLowerCase() === 'v' ? 'ü' : baseChar.toLowerCase()
  const toned = toneVowel(normalized, tone)
  return isUppercaseLetter(baseChar) ? toned.toUpperCase() : toned
}

// Tone placement follows standard Pinyin ordering rules: a/e first, then ou/iu/ui, then the last vowel.

function replaceToneVowel(base: string, tone: number): string {
  const lower = base.toLowerCase()
  const lastA = lower.lastIndexOf('a')
  if (lastA !== -1) return base.slice(0, lastA) + applyTone(base[lastA]!, tone) + base.slice(lastA + 1)

  const lastE = lower.lastIndexOf('e')
  if (lastE !== -1) return base.slice(0, lastE) + applyTone(base[lastE]!, tone) + base.slice(lastE + 1)

  if (lower.includes('ou')) {
    const index = lower.indexOf('o')
    return base.slice(0, index) + applyTone(base[index]!, tone) + base.slice(index + 1)
  }

  if (lower.includes('iu')) {
    const index = lower.indexOf('u')
    return base.slice(0, index) + applyTone(base[index]!, tone) + base.slice(index + 1)
  }

  if (lower.includes('ui')) {
    const index = lower.indexOf('i')
    return base.slice(0, index) + applyTone(base[index]!, tone) + base.slice(index + 1)
  }

  const vowels = ['a', 'e', 'o', 'i', 'u', 'ü']
  for (let i = base.length - 1; i >= 0; i -= 1) {
    const vowel = vowelAt(base, i)
    if (vowel && vowels.includes(vowel)) {
      return base.slice(0, i) + applyTone(base[i]!, tone) + base.slice(i + 1)
    }
  }

  return base
}

export function formatPinyin(raw: string): string {
  const syllables = raw.trim().replace(/u:/gi, match => match[0] === 'U' ? 'Ü' : 'ü').split(/\s+/).filter(Boolean)
  if (!syllables.length) return ''

  return syllables
    .map(syl => {
      const tone = toneFromPinyin(syl)
      if (!tone) return syl
      const base = syl.replace(/\d$/, '')
      return replaceToneVowel(base, tone)
    })
    .join(' ')
}

function surnameLength(chars: string[]): number {
  if (!chars.length) return 0

  const joinedTwo = chars.length >= 2 ? chars[0]! + chars[1]! : ''
  if (COMMON_COMPOUND_SURNAMES.has(joinedTwo)) return 2

  if (surnameDict?.[joinedTwo]) return 2
  if (surnameDict?.[chars[0]!]) return 1
  return 0
}

function segment(chars: string[]): ('surname' | 'given')[] {
  if (!surnameDict) return chars.map(() => 'given')

  const roles: ('surname' | 'given')[] = []
  const surnameCount = surnameLength(chars)

  if (surnameCount > 0) {
    for (let i = 0; i < surnameCount; i += 1) roles.push('surname')
    for (let i = surnameCount; i < chars.length; i += 1) roles.push('given')
  } else {
    for (let i = 0; i < chars.length; i += 1) roles.push('given')
  }

  return roles
}

export async function preloadDictionary(): Promise<void> {
  await loadData()
}

export async function analyzeName(input: string): Promise<AnalyzedName> {
  await loadData()
  const trimmedInput = input.trim()
  const chars = [...trimmedInput]
  const roles = segment(chars)
  const surnameCount = roles.findIndex(role => role === 'given')
  const actualSurnameCount = surnameCount === -1 ? roles.length : surnameCount
  const compoundReading = actualSurnameCount === 2
    ? compoundSurnamePinyin[chars.slice(0, 2).join('') as keyof typeof compoundSurnamePinyin]?.split(/\s+/)
    : undefined

  const analyzed: AnalyzedChar[] = chars.map((char, i) => {
    const role = roles[i] ?? 'given'
    const contextualPinyin = role === 'surname'
      ? compoundReading?.[i] ?? (actualSurnameCount === 1 ? surnameDict?.[char] : undefined)
      : undefined
    return {
      char,
      role,
      entry: sanitizeEntry(withPinyin(lookupChar(char), contextualPinyin), role),
      cultural: getCulturalData(char),
    }
  })

  return { original: trimmedInput, chars: analyzed }
}
