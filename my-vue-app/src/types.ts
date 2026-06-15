export interface CharEntry {
  pinyin: string
  traditional: string | null
  definitions: string[]
}

export interface CulturalData {
  element?: string
  elementEmoji?: string
  connotation?: string
  genderBias?: 'masculine' | 'feminine' | 'neutral'
  literaryRef?: string
  localGloss?: string
}

export interface AnalyzedChar {
  char: string
  role: 'surname' | 'given'
  entry: CharEntry | null
  cultural: CulturalData | null
}

export interface AnalyzedName {
  original: string
  chars: AnalyzedChar[]
}

export interface AiAnalysisResult {
  labels: string[]
  summary: string
  loadedFromCache: boolean
  source: 'model' | 'fallback'
}

export interface AnalysisHistoryEntry {
  id: string
  input: string
  createdAt: number
  result: AnalyzedName
}
