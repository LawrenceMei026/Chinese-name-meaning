import type { AnalyzedChar, AnalyzedName, CharEntry } from '../types'
import { getCulturalData } from '../data/cultural'

type RawDict = Record<string, [string, string | null, ...string[]]>
type SurnameDict = Record<string, string>

let charDict: RawDict | null = null
let surnameSet: Set<string> | null = null

async function loadData() {
  if (charDict && surnameSet) return
  const [charsRes, surnamesRes] = await Promise.all([
    fetch('/data/chars.json'),
    fetch('/data/surnames.json'),
  ])

  if (!charsRes.ok || !surnamesRes.ok) {
    throw new Error('Dictionary data failed to load')
  }

  charDict = await charsRes.json() as RawDict
  const surnames = await surnamesRes.json() as SurnameDict
  surnameSet = new Set(Object.keys(surnames))
}

function parseEntry(raw: [string, string | null, ...string[]]): CharEntry {
  const [pinyin, traditional, ...definitions] = raw
  return { pinyin, traditional: traditional ?? null, definitions }
}

function lookupChar(char: string): CharEntry | null {
  if (!charDict) return null
  const raw = charDict[char]
  if (!raw) return null
  return parseEntry(raw)
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

function replaceToneVowel(base: string, tone: number): string {
  const priority = [
    /a/i,
    /e/i,
    /ou/i,
    /o/i,
    /iu/i,
    /ui/i,
    /[aeoiuü]/i,
  ]

  for (const pattern of priority) {
    const match = base.match(pattern)
    if (!match) continue

    if (pattern.source === 'ou') {
      return base.replace(/o/i, m => toneMap[m.toLowerCase()]![tone - 1] ?? m)
    }

    if (pattern.source === 'iu') {
      return base.replace(/u/i, m => toneMap[m.toLowerCase()]![tone - 1] ?? m)
    }

    if (pattern.source === 'ui') {
      return base.replace(/i/i, m => toneMap[m.toLowerCase()]![tone - 1] ?? m)
    }

    return base.replace(match[0]!, m => toneMap[m.toLowerCase()]![tone - 1] ?? m)
  }

  return base
}

export function formatPinyin(raw: string): string {
  return raw
    .split(' ')
    .map(syl => {
      const tone = toneFromPinyin(syl)
      if (!tone) return syl
      const base = syl.replace(/\d$/, '')
      return replaceToneVowel(base, tone)
    })
    .join(' ')
}

function segment(chars: string[]): ('surname' | 'given')[] {
  if (!surnameSet) return chars.map(() => 'given')
  const roles: ('surname' | 'given')[] = []
  if (chars.length >= 2 && surnameSet.has(chars[0]! + chars[1]!)) {
    roles.push('surname', 'surname')
    for (let i = 2; i < chars.length; i++) roles.push('given')
  } else if (surnameSet.has(chars[0]!)) {
    roles.push('surname')
    for (let i = 1; i < chars.length; i++) roles.push('given')
  } else {
    for (let i = 0; i < chars.length; i++) roles.push('given')
  }
  return roles
}

export async function preloadDictionary(): Promise<void> {
  await loadData()
}

export async function analyzeName(input: string): Promise<AnalyzedName> {
  await loadData()
  const chars = [...input.trim()]
  const roles = segment(chars)

  const analyzed: AnalyzedChar[] = chars.map((char, i) => ({
    char,
    role: roles[i] ?? 'given',
    entry: lookupChar(char),
    cultural: getCulturalData(char),
  }))

  return { original: input.trim(), chars: analyzed }
}
