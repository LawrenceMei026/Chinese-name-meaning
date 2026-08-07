import type { AnalyzedChar, AnalyzedName } from '../types'

export type GroundingMeaningSource = 'curated-local-gloss' | 'reviewed-connotation' | 'reviewed-dictionary' | 'none'

export interface GroundingFactCharacter {
  char: string
  role: 'surname' | 'given'
  meaning: string | null
  meaningSource: GroundingMeaningSource
  literaryReference: string | null
  radical: string | null
  pinyin: string | null
  tones: string | null
  connotation: string | null
  localGloss: string | null
}

export interface GroundingFactPacket {
  schemaVersion: 'grounding-facts-v1'
  name: string
  surname: string
  givenName: string
  structure: {
    isCompoundSurname: boolean
    isSingleCharacterGivenName: boolean
    isRepeatedGivenName: boolean
  }
  characters: GroundingFactCharacter[]
}

export function cleanNamingDefinition(text: string): string {
  if (!text) return ''
  if (/(?:会意|形声|象形|指事|小篆字形)/u.test(text)) return ''
  const unusable = /(?:会意|形声|象形|指事|转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从[\u3400-\u9fff]|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  const segments = text
    .replace(/^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s\d]+/, '')
    .split(/[。；;！？!，,]/)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/g, '').trim())
    .filter(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
  return segments[0]?.slice(0, 24) ?? ''
}

function reviewedConnotation(char: AnalyzedChar): string {
  return char.cultural?.connotation?.split(/[；。]/)[0]?.trim() || ''
}

export function namingMeaningDetails(char: AnalyzedChar): { meaning: string | null; source: GroundingMeaningSource } {
  const gloss = char.cultural?.localGloss?.trim()
  if (gloss) return { meaning: gloss, source: 'curated-local-gloss' }

  const connotation = reviewedConnotation(char)
  if (connotation) return { meaning: connotation, source: 'reviewed-connotation' }

  const definition = cleanNamingDefinition(char.entry?.definition_cn || '')
  if (definition) return { meaning: definition, source: 'reviewed-dictionary' }

  return { meaning: null, source: 'none' }
}

export function buildGroundingFactPacket(result: AnalyzedName): GroundingFactPacket {
  const surnameChars = result.chars.filter(char => char.role === 'surname')
  const givenChars = result.chars.filter(char => char.role === 'given')
  const givenName = givenChars.map(char => char.char).join('')

  return {
    schemaVersion: 'grounding-facts-v1',
    name: result.original,
    surname: surnameChars.map(char => char.char).join(''),
    givenName,
    structure: {
      isCompoundSurname: surnameChars.length > 1,
      isSingleCharacterGivenName: givenChars.length === 1,
      isRepeatedGivenName: givenChars.length > 1 && new Set(givenChars.map(char => char.char)).size === 1,
    },
    characters: result.chars.map(char => {
      const { meaning, source } = namingMeaningDetails(char)
      return {
        char: char.char,
        role: char.role,
        meaning,
        meaningSource: source,
        literaryReference: char.cultural?.literaryRef?.trim() || null,
        radical: char.entry?.radical?.trim() || null,
        pinyin: char.entry?.pinyin?.trim() || null,
        tones: char.entry?.tones?.trim() || null,
        connotation: reviewedConnotation(char) || null,
        localGloss: char.cultural?.localGloss?.trim() || null,
      }
    }),
  }
}
