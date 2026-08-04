import type { CulturalData } from '../types'
import culturalMap from './cultural.json'

const culturalEntries = culturalMap as Record<string, CulturalData>

export function isUsableCulturalData(data: CulturalData): boolean {
  const gloss = data.localGloss?.trim() ?? ''
  const connotation = data.connotation?.trim() ?? ''
  return Boolean(gloss)
    && Boolean(connotation)
    && !/；名字里常取.+的感觉。$/u.test(connotation)
    && !gloss.endsWith('切')
    && !/^(?:音.{1,4}|反切.*)$/u.test(gloss)
    && !/(?:俗|古文).{0,4}字/u.test(gloss)
    && !/(?:與|与).{0,4}同/u.test(gloss)
    && !/^同.{1,4}$/u.test(gloss)
}

export function getCulturalData(char: string): CulturalData | null {
  const data = culturalEntries[char]
  return data && isUsableCulturalData(data) ? data : null
}
