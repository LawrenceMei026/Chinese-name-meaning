import type { CulturalData } from '../types'
import culturalMap from './cultural.json'

const culturalEntries = culturalMap as Record<string, CulturalData>

export function getCulturalData(char: string): CulturalData | null {
  return culturalEntries[char] ?? null
}
