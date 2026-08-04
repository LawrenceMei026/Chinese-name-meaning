import { describe, expect, it } from 'vitest'
import { extractModernChineseDefinitions } from '../../scripts/lib/zhwiktionary-parser.mjs'

describe('Chinese Wiktionary parser', () => {
  it('extracts only modern Chinese definitions from mixed-language pages', () => {
    const page = `
==漢語==
===讀音===
# 讀作 qín
===名詞===
# 一種[[弦樂器|弦乐器]]。
# {{lb|zh|引申}}琴一类的乐器。
===字源===
# 象形字，上古音巨今切。
===異體字===
# 同「珡」。
==日語==
===名詞===
# 日本传统乐器。
`

    expect(extractModernChineseDefinitions(page)).toEqual([
      '一種弦乐器。',
      '（引申）琴一类的乐器。',
    ])
  })

  it('does not treat translations or pages without Chinese definitions as meanings', () => {
    const page = `
==漢語==
===讀音===
{{zh-pron|m=sù}}
===翻譯===
* {{en}}：plain; normally
==日語==
===名詞===
# 本真。
`

    expect(extractModernChineseDefinitions(page)).toEqual([])
  })
})
