import { describe, expect, it } from 'vitest'
import fixtures from '../model/feature-fixtures.v1.json'
import manifest from '../../public/models/manifest.json'
import { FEATURE_CONTRACT, buildFeatureVector, pickFallbackLabels, toFeatureInput } from '../model/nameFeatures'
import type { AnalyzedChar, AnalyzedName } from '../types'

describe('name feature contract', () => {
  it('defines ten unique production labels', () => {
    expect(FEATURE_CONTRACT.labels).toHaveLength(10)
    expect(new Set(FEATURE_CONTRACT.labels).size).toBe(10)
  })

  it('keeps fallback predictions inside the production label contract', () => {
    const labels = pickFallbackLabels('书墨山川刚毅灵动深远')

    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThanOrEqual(3)
    expect(labels.every(label => FEATURE_CONTRACT.labels.includes(label))).toBe(true)
    expect(pickFallbackLabels('未命中任何规则')).toEqual([])
  })

  it('matches the deployed model manifest', () => {
    expect(manifest.modelSize).toBe(16312)
    expect(manifest.modelSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(manifest.featureSize).toBe(FEATURE_CONTRACT.size)
    expect(manifest.outputSize).toBe(FEATURE_CONTRACT.labels.length)
    expect(manifest.featureContractVersion).toBe(FEATURE_CONTRACT.version)
    expect(manifest.labels).toEqual(FEATURE_CONTRACT.labels)
  })

  it('serializes exactly the fields declared by the feature contract', () => {
    const result: AnalyzedName = {
      original: '李明',
      chars: [{
        char: '明',
        role: 'given',
        entry: {
          pinyin: 'míng',
          tones: '2',
          definition_cn: '明亮',
          radical: '日',
          freq: 42,
        },
        cultural: {
          element: '火',
          elementEmoji: '火',
          connotation: '光明',
          genderBias: 'neutral',
          literaryRef: '典故',
          localGloss: '日光',
        },
      }],
    }

    const serialized = toFeatureInput(result).chars[0]!

    expect(Object.keys(serialized)).toEqual(FEATURE_CONTRACT.input.characterFields)
    expect(Object.keys(serialized.entry!)).toEqual(FEATURE_CONTRACT.input.entryFields)
    expect(Object.keys(serialized.cultural!)).toEqual(FEATURE_CONTRACT.input.culturalFields)
    expect(serialized.entry).toHaveProperty('radical', '日')
    expect(serialized.entry).not.toHaveProperty('freq')
    expect(FEATURE_CONTRACT.input.excludedEntryFields).toContain('freq')
  })

  it.each(fixtures.cases)('matches the shared $name fixture', ({ chars, expected }) => {
    expect(fixtures.contractVersion).toBe(FEATURE_CONTRACT.version)

    const actual = Array.from(buildFeatureVector(chars as AnalyzedChar[]))

    expect(actual).toHaveLength(FEATURE_CONTRACT.size)
    actual.forEach((value, index) => {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeCloseTo(expected[index]!, 6)
    })
  })
})
