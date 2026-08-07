import { describe, expect, it } from 'vitest'
import { FEATURE_CONTRACT } from '../model/nameFeatures'
import { hasExpectedLabelOrder, hasOnlyFiniteScores, normaliseDigest, pickModelLabels, sha256Hex } from '../workers/localInference.worker'

describe('local inference worker validation', () => {
  it('accepts the production label order only when it matches the feature contract exactly', () => {
    expect(hasExpectedLabelOrder(FEATURE_CONTRACT.labels)).toBe(true)
    expect(hasExpectedLabelOrder([...FEATURE_CONTRACT.labels].reverse())).toBe(false)
    expect(hasExpectedLabelOrder(FEATURE_CONTRACT.labels.slice(0, -1))).toBe(false)
    expect(hasExpectedLabelOrder([...FEATURE_CONTRACT.labels.slice(0, 1), '错误标签', ...FEATURE_CONTRACT.labels.slice(2)])).toBe(false)
  })

  it('rejects non-finite ONNX scores', () => {
    expect(hasOnlyFiniteScores([0.2, 0.5, 1, -0.2])).toBe(true)
    expect(hasOnlyFiniteScores([0.2, Number.NaN, 1])).toBe(false)
    expect(hasOnlyFiniteScores([0.2, Number.POSITIVE_INFINITY, 1])).toBe(false)
    expect(hasOnlyFiniteScores([0.2, Number.NEGATIVE_INFINITY, 1])).toBe(false)
  })

  it('normalizes only valid lowercase or uppercase SHA-256 digests', () => {
    expect(normaliseDigest('678B7C10B65F8A242598074026737BE91A893040EBBB140EEBB6A3F945B627E1')).toBe('678b7c10b65f8a242598074026737be91a893040ebbb140eebb6a3f945b627e1')
    expect(normaliseDigest('bad-digest')).toBeUndefined()
    expect(normaliseDigest(123)).toBeUndefined()
  })

  it('computes SHA-256 for ONNX artifact verification', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('classifier').buffer)

    expect(digest).toBe('fe1991a9d8b6abd7ff7c58d5e22b4538a75dadae9f33dcca784e7a87c2d0f6ae')
  })

  it('abstains when the top ONNX score is below the confidence threshold', () => {
    expect(pickModelLabels([0.4, 0.2, 0.1], ['书卷', '典雅', '自然'])).toEqual([])
  })

  it('abstains when the top two ONNX scores are too close', () => {
    expect(pickModelLabels([0.62, 0.59, 0.1], ['书卷', '典雅', '自然'])).toEqual([])
  })

  it('returns at most two confident ONNX labels', () => {
    expect(pickModelLabels([0.82, 0.63, 0.61, 0.2], ['书卷', '典雅', '自然', '坚毅'])).toEqual(['书卷', '典雅'])
  })
})
