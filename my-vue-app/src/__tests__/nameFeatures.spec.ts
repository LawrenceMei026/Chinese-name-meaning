import { describe, expect, it } from 'vitest'
import fixtures from '../model/feature-fixtures.v1.json'
import manifest from '../../public/models/manifest.json'
import { FEATURE_CONTRACT, buildFeatureVector } from '../model/nameFeatures'
import type { AnalyzedChar } from '../types'

describe('name feature contract', () => {
  it('matches the deployed model manifest', () => {
    expect(manifest.featureSize).toBe(FEATURE_CONTRACT.size)
    expect(manifest.featureContractVersion).toBe(FEATURE_CONTRACT.version)
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
