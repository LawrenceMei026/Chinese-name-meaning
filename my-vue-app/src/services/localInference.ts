import type { AnalyzedName, AiAnalysisResult } from '../types'

const MODEL_VERSION = 'v1'
const MODEL_MANIFEST = '/models/manifest.json'

let modelPromise: Promise<boolean> | null = null
let manifestLoaded = false

async function loadManifest() {
  if (manifestLoaded) return true

  const res = await fetch(MODEL_MANIFEST)
  if (!res.ok) return false

  manifestLoaded = true
  return true
}

async function loadModel() {
  if (!modelPromise) {
    modelPromise = loadManifest()
  }

  return modelPromise
}

function buildFeatureText(result: AnalyzedName) {
  const charParts = result.chars.map(char => {
    const entry = char.entry
    const cultural = char.cultural
    const meanings = entry?.definitions.slice(0, 2).join('；') ?? '未收录'
    const culture = cultural
      ? [cultural.element ? `${cultural.element}行` : '', cultural.connotation ?? '', cultural.genderBias ?? '']
          .filter(Boolean)
          .join('；')
      : '无文化标签'

    return `${char.char}(${char.role})：${meanings}｜${culture}`
  })

  return [
    `姓名：${result.original}`,
    ...charParts,
    `模型版本：${MODEL_VERSION}`,
  ].join('\n')
}

function pickLabels(text: string): string[] {
  const labels: string[] = []
  if (/[明华文雅诗书兰]/.test(text)) labels.push('文雅')
  if (/[山海江川峰岳远志伟豪强]/.test(text)) labels.push('大气')
  if (/[龙武刚勇阳天雄]/.test(text)) labels.push('阳刚')
  if (/[月雪云雨莲梅兰花秀柔]/.test(text)) labels.push('柔和')
  if (/[古春秋竹松]/.test(text)) labels.push('古典')
  if (/[新现代睿卓敏]/.test(text)) labels.push('现代')
  return labels.length ? [...new Set(labels)].slice(0, 3) : ['中性']
}

function buildSummary(labels: string[], result: AnalyzedName, source: 'model' | 'fallback') {
  const lead = labels.slice(0, 2).join('、')
  if (!lead) return '名字整体气质平衡，适合进一步结合字义与声调判断。'
  const base = `名字整体呈现${lead}的气质，结合字义来看，和其文化意涵较为一致。`
  return source === 'fallback' ? `${base} 当前使用的是本地规则回退结果。` : base
}

export async function runLocalAiAnalysis(result: AnalyzedName): Promise<AiAnalysisResult> {
  const loadedFromCache = await loadModel()
  const featureText = buildFeatureText(result)
  const labels = pickLabels(featureText)
  const source = loadedFromCache ? 'model' : 'fallback'

  return {
    labels,
    summary: buildSummary(labels, result, source),
    loadedFromCache,
    source,
  }
}
