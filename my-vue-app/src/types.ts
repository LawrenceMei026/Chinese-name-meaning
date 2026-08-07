export interface CharEntry {
  pinyin: string
  tones: string
  definition_cn: string
  freq?: number
  radical?: string
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
  labelSource: 'model' | 'fallback' | 'none'
  summarySource: 'native' | 'ollama' | 'fallback'
  generationStatus?: 'complete' | 'degraded'
  provenance?: {
    schemaVersion: 1
    generatedAt: number
    classifierModelVersion?: string
    groundingPolicyVersion?: string
    validatorVersion?: string
  }
}

export interface AnalysisHistoryEntry {
  schemaVersion: 2
  id: string
  input: string
  createdAt: number
  result: AnalyzedName
  legacy?: boolean
  aiResult?: AiAnalysisResult | null
}
