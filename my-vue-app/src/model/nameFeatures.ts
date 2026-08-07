import contract from './feature-contract.v1.json'
import type { AnalyzedChar, AnalyzedName } from '../types'

export const FEATURE_CONTRACT = contract

export type FeatureInput = {
  original: string
  chars: Array<{
    char: string
    role: 'surname' | 'given'
    entry: {
      pinyin: string
      tones: string
      definition_cn: string
      radical?: string
    } | null
    cultural: {
      element?: string
      genderBias?: 'masculine' | 'feminine' | 'neutral'
      literaryRef?: string
      localGloss?: string
    } | null
  }>
}

export function toFeatureInput(result: AnalyzedName): FeatureInput {
  return {
    original: result.original,
    chars: result.chars.map(char => ({
      char: char.char,
      role: char.role,
      entry: char.entry
        ? {
            pinyin: char.entry.pinyin,
            tones: char.entry.tones,
            definition_cn: char.entry.definition_cn,
            radical: char.entry.radical,
          }
        : null,
      cultural: char.cultural
        ? {
            element: char.cultural.element,
            genderBias: char.cultural.genderBias,
            literaryRef: char.cultural.literaryRef,
            localGloss: char.cultural.localGloss,
          }
        : null,
    })),
  }
}

export function pickFallbackLabels(text: string): string[] {
  const labels: string[] = []
  if (/[明华文雅诗书兰慕翰墨博思哲韵谦修德贤]/.test(text)) labels.push('书卷')
  if (/[宇宙瀚海天乾坤鹏宏霄浩广阔疆泰]/.test(text)) labels.push('宏伟')
  if (/[龙虎啸骁猛锐傲凌风云腾飞剑昂壮]/.test(text)) labels.push('豪迈')
  if (/[婉柔静悦梦茹薇洁恬琳曼芊淑安宁悠]/.test(text)) labels.push('恬静')
  if (/[子墨轩逸若望归词赋朝礼仪正纯质真]/.test(text)) labels.push('典雅')
  if (/[希语涵奕凡诺星熙芮沐可乐予其于也]/.test(text)) labels.push('新颖')
  if (/[舒悠然悦灵颖芸羽翔逸流光影旋舞翩]/.test(text)) labels.push('灵动')
  if (/[刚强勇健毅峰军武力锋威定松柏岩钧]/.test(text)) labels.push('坚毅')
  if (/[山川岳林森沐汐阳月雪云雨溪木禾竹]/.test(text)) labels.push('自然')
  if (/[远幽潜深玄微妙默思冥理道索究渊鉴]/.test(text)) labels.push('深邃')
  return labels.length ? [...new Set(labels)].slice(0, 3) : []
}

function containsAny(value: string, candidates: string[]) {
  return candidates.some(candidate => value.includes(candidate))
}

function firstTone(value: string | undefined) {
  const first = value?.match(/\d/)?.[0]
  return first ? Number(first) : 0
}

export function buildFeatureVector(chars: FeatureInput['chars'] | AnalyzedChar[]): Float32Array {
  if (contract.size !== contract.features.length) {
    throw new Error(`Feature contract size ${contract.size} does not match ${contract.features.length} features.`)
  }

  const scopedChars = contract.characterScope === 'given'
    ? chars.filter(char => char.role === 'given')
    : chars
  const counts = {
    water: 0,
    wood: 0,
    fire: 0,
    metal: 0,
    earth: 0,
    masculine: 0,
    feminine: 0,
    literary: 0,
    natureRadical: 0,
    humanRadical: 0,
    abstractRadical: 0,
    beauty: 0,
    strength: 0,
    virtue: 0,
    nature: 0,
    strongInitials: 0,
  }
  let totalVowels = 0
  let openVowels = 0
  let toneChanges = 0
  let comparableTonePairs = 0
  let lastTone = -1

  for (const char of scopedChars) {
    const entry = char.entry
    const cultural = char.cultural

    if (cultural?.element === '水') counts.water += 1
    if (cultural?.element === '木') counts.wood += 1
    if (cultural?.element === '火') counts.fire += 1
    if (cultural?.element === '金') counts.metal += 1
    if (cultural?.element === '土') counts.earth += 1
    if (cultural?.genderBias === 'masculine') counts.masculine += 1
    if (cultural?.genderBias === 'feminine') counts.feminine += 1
    if (cultural?.literaryRef) counts.literary += 1

    const radical = entry?.radical || cultural?.localGloss || ''
    if (containsAny(radical, contract.radicals.nature)) counts.natureRadical += 1
    if (containsAny(radical, contract.radicals.human)) counts.humanRadical += 1
    if (containsAny(radical, contract.radicals.abstract)) counts.abstractRadical += 1

    const definition = entry?.definition_cn || ''
    if (containsAny(definition, contract.semantics.beauty)) counts.beauty += 1
    if (containsAny(definition, contract.semantics.strength)) counts.strength += 1
    if (containsAny(definition, contract.semantics.virtue)) counts.virtue += 1
    if (containsAny(definition, contract.semantics.nature)) counts.nature += 1

    const pinyin = [...(entry?.pinyin.toLowerCase() || '')]
      .map(letter => contract.phonetics.toneVowelMap[letter as keyof typeof contract.phonetics.toneVowelMap] ?? letter)
      .join('')
    const firstVowelIndex = [...pinyin].findIndex(letter => contract.phonetics.vowels.includes(letter))
    const initials = firstVowelIndex === -1 ? pinyin : pinyin.slice(0, firstVowelIndex)
    if (containsAny(initials, contract.phonetics.strongInitials)) counts.strongInitials += 1

    for (const letter of pinyin) {
      if (!contract.phonetics.vowels.includes(letter)) continue
      totalVowels += 1
      if (contract.phonetics.openVowels.includes(letter)) openVowels += 1
    }

    const currentTone = firstTone(entry?.tones)
    if (lastTone > 0 && currentTone > 0) {
      comparableTonePairs += 1
      const lastIsPing = contract.phonetics.pingTones.includes(lastTone)
      const currentIsPing = contract.phonetics.pingTones.includes(currentTone)
      if (lastIsPing !== currentIsPing) toneChanges += 1
    }
    lastTone = currentTone
  }

  const length = scopedChars.length || 1
  const features = new Float32Array(contract.size)
  features[0] = length / contract.weights.lengthDivisor
  features[1] = 0
  features[2] = (counts.masculine - counts.feminine) / length
  features[3] = [counts.water, counts.wood, counts.fire, counts.metal, counts.earth]
    .filter(count => count > 0).length / contract.weights.elementDiversityDivisor
  features[4] = counts.literary / length
  features[5] = counts.metal / length
  features[6] = counts.wood / length
  features[7] = counts.water / length
  features[8] = counts.fire / length
  features[9] = counts.earth / length
  features[10] = totalVowels > 0 ? openVowels / totalVowels : 0
  features[11] = comparableTonePairs > 0 ? toneChanges / comparableTonePairs : 0
  features[12] = (counts.natureRadical / length) * contract.weights.radical
    + (counts.nature / length) * contract.weights.semantic
  features[13] = (counts.humanRadical / length) * contract.weights.radical
    + (counts.virtue / length) * contract.weights.semantic
  features[14] = (counts.abstractRadical / length) * contract.weights.radical
    + (counts.strength / length) * contract.weights.semantic
  features[15] = (counts.strongInitials / length) * contract.weights.strongInitial
    + (counts.beauty / length) * contract.weights.beauty

  return features
}
