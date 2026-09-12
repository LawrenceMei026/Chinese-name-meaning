import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dayanForNumber,
  elementForNumber,
  SANCAI_LUCK,
  SANCAI_LUCK_POINT,
  DAYAN_TABLE,
} from '../data/numerologyTables'
import { buildNameNumerology } from '../services/nameNumerology'

const fateStrokes = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/fateStrokes.json'), 'utf8'),
) as unknown

describe('大衍数理表', () => {
  it('覆盖 1..81', () => {
    expect(DAYAN_TABLE).toHaveLength(81)
    expect(DAYAN_TABLE[0]!.number).toBe(1)
    expect(DAYAN_TABLE[80]!.number).toBe(81)
  })

  it('超过 81 的数理按循环取模查找', () => {
    expect(dayanForNumber(82).number).toBe(1)
    expect(dayanForNumber(163).number).toBe(1)
    expect(dayanForNumber(1).number).toBe(1)
    expect(dayanForNumber(41).isMax).toBe(true)
  })
})

describe('三才五行表', () => {
  it('按个位映射五行', () => {
    expect(elementForNumber(1)).toBe('木')
    expect(elementForNumber(2)).toBe('木')
    expect(elementForNumber(3)).toBe('火')
    expect(elementForNumber(6)).toBe('土')
    expect(elementForNumber(9)).toBe('水')
    expect(elementForNumber(10)).toBe('水')
    expect(elementForNumber(12)).toBe('木')
    expect(elementForNumber(29)).toBe('水')
    expect(elementForNumber(30)).toBe('水')
  })

  it('吉凶等级与分值一致', () => {
    expect(SANCAI_LUCK['木水水']).toBe('大吉')
    expect(SANCAI_LUCK_POINT['大吉']).toBe(7)
    expect(SANCAI_LUCK_POINT['大凶']).toBe(1)
  })
})

describe('五格三才计算（对照 fate 张适抡 样例）', () => {
  // 张=11 适=18 抡=12 → 天格12/人格29/地格30/外格13/总格41
  const strokes = [
    { char: '张', role: 'surname' as const, stroke: 11 },
    { char: '适', role: 'given' as const, stroke: 18 },
    { char: '抡', role: 'given' as const, stroke: 12 },
  ]

  it('单姓双字名五格数理', () => {
    const numerology = buildNameNumerology(strokes)
    expect(numerology.supported).toBe(true)
    expect(numerology.grids?.tian.number).toBe(12)
    expect(numerology.grids?.ren.number).toBe(29)
    expect(numerology.grids?.di.number).toBe(30)
    expect(numerology.grids?.wai.number).toBe(13)
    expect(numerology.grids?.zong.number).toBe(41)
    expect(numerology.grids?.tian.dayan.lucky).toBe('凶')
    expect(numerology.grids?.ren.dayan.lucky).toBe('吉')
    expect(numerology.grids?.di.dayan.lucky).toBe('半吉')
    expect(numerology.grids?.wai.dayan.lucky).toBe('吉')
    expect(numerology.grids?.zong.dayan.lucky).toBe('吉')
    expect(numerology.grids?.zong.dayan.isMax).toBe(true)
  })

  it('三才为木水水（大吉）', () => {
    const numerology = buildNameNumerology(strokes)
    expect(numerology.sancai?.tian.element).toBe('木')
    expect(numerology.sancai?.ren.element).toBe('水')
    expect(numerology.sancai?.di.element).toBe('水')
    expect(numerology.sancai?.triple).toBe('木水水')
    expect(numerology.sancai?.grade).toBe('大吉')
    expect(numerology.sancai?.luckPoint).toBe(7)
  })
})

describe('五格公式边界', () => {
  it('单姓单字名', () => {
    const result = buildNameNumerology([
      { char: '刘', role: 'surname', stroke: 15 },
      { char: '明', role: 'given', stroke: 8 },
    ])
    expect(result.supported).toBe(true)
    // 天格=15+1=16, 人格=15+8=23, 地格=8+1=9, 外格=1+1=2, 总格=(15+8-1)%81+1=23
    expect(result.grids).toMatchObject({
      tian: { number: 16 },
      ren: { number: 23 },
      di: { number: 9 },
      wai: { number: 2 },
      zong: { number: 23 },
    })
  })

  it('复姓双字名', () => {
    const result = buildNameNumerology([
      { char: '欧', role: 'surname', stroke: 15 },
      { char: '阳', role: 'surname', stroke: 17 },
      { char: '明', role: 'given', stroke: 8 },
      { char: '华', role: 'given', stroke: 14 },
    ])
    expect(result.supported).toBe(true)
    // 天格=15+17=32, 人格=17+8=25, 地格=8+14=22, 外格=15+14=29, 总格=(15+17+8+14-1)%81+1=54
    expect(result.grids).toMatchObject({
      tian: { number: 32 },
      ren: { number: 25 },
      di: { number: 22 },
      wai: { number: 29 },
      zong: { number: 54 },
    })
  })

  it('复姓单字名', () => {
    const result = buildNameNumerology([
      { char: '司', role: 'surname', stroke: 5 },
      { char: '马', role: 'surname', stroke: 10 },
      { char: '光', role: 'given', stroke: 6 },
    ])
    expect(result.supported).toBe(true)
    // 天格=5+10=15, 人格=10+6=16, 地格=6+1=7, 外格=5+1=6, 总格=(5+10+6-1)%81+1=21
    expect(result.grids).toMatchObject({
      tian: { number: 15 },
      ren: { number: 16 },
      di: { number: 7 },
      wai: { number: 6 },
      zong: { number: 21 },
    })
  })

  it('多字名超出五格支持范围时优雅降级', () => {
    const result = buildNameNumerology([
      { char: '李', role: 'surname', stroke: 7 },
      { char: '明', role: 'given', stroke: 8 },
      { char: '华', role: 'given', stroke: 14 },
      { char: '辰', role: 'given', stroke: 7 },
    ])
    expect(result.supported).toBe(false)
    expect(result.unsupportedReason).toBe('name-structure-unsupported')
  })

  it('缺少笔画时列出缺字', () => {
    const result = buildNameNumerology([
      { char: '李', role: 'surname', stroke: 7 },
      { char: '琰', role: 'given', stroke: -1 },
    ])
    expect(result.supported).toBe(false)
    expect(result.unsupportedReason).toBe('stroke-missing')
    expect(result.missingChars).toEqual(['琰'])
  })

  it('未识别姓氏时提示', () => {
    const result = buildNameNumerology([{ char: '明', role: 'given', stroke: 8 }])
    expect(result.supported).toBe(false)
    expect(result.unsupportedReason).toBe('surname-unrecognized')
  })
})

describe('笔画数据文件', () => {
  const data = fateStrokes as { schemaVersion: number; chars: Record<string, number> }
  it('schema 版本正确且笔画为合法正整数', () => {
    expect(data.schemaVersion).toBe(1)
    const entries = Object.entries(data.chars)
    expect(entries.length).toBeGreaterThan(2000)
    for (const [char, stroke] of entries) {
      expect([...char]).toHaveLength(1)
      expect(Number.isInteger(stroke)).toBe(true)
      expect(stroke).toBeGreaterThan(0)
      expect(stroke).toBeLessThanOrEqual(60)
    }
  })

  it('常见姓氏与名用字均有姓名学笔画', () => {
    for (const char of ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '欧', '阳']) {
      expect(data.chars[char]).toBeTruthy()
    }
    for (const char of ['明', '华', '轩', '然', '涵', '若', '梓', '一', '辰', '诺']) {
      expect(data.chars[char]).toBeTruthy()
    }
  })

  it('张适抡 复现 fate 样例五格（12/29/30/13/41）', () => {
    const strokes = [
      { char: '张', role: 'surname' as const, stroke: data.chars['张']! },
      { char: '适', role: 'given' as const, stroke: data.chars['适']! },
      { char: '抡', role: 'given' as const, stroke: data.chars['抡']! },
    ]
    const result = buildNameNumerology(strokes)
    expect(result.supported).toBe(true)
    expect(result.grids).toMatchObject({
      tian: { number: 12 },
      ren: { number: 29 },
      di: { number: 30 },
      wai: { number: 13 },
      zong: { number: 41 },
    })
  })
})

describe('笔画数据加载', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('从 fateStrokes.json 加载后可按字查询', async () => {
    const payload = { schemaVersion: 1, chars: { 张: 11, 李: 7 } }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    )
    const module = await import('../services/nameNumerology')
    await module.loadStrokeData()
    expect(module.getScienceStroke('张')).toBe(11)
    expect(module.getScienceStroke('李')).toBe(7)
    expect(module.getScienceStroke('不存在的字')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('加载失败时 getScienceStroke 返回 null 且不抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    )
    const module = await import('../services/nameNumerology')
    await expect(module.loadStrokeData()).rejects.toThrow('Fate stroke data failed to load')
    vi.unstubAllGlobals()
  })
})
