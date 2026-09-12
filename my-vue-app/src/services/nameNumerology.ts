import type { AnalyzedChar, AnalyzedName } from '../types'
import {
  dayanForNumber,
  elementForNumber,
  sancaiGrade,
  sancaiLuckPoint,
} from '../data/numerologyTables'
import type { DaYanEntry, ElementName, SancaiGrade } from '../data/numerologyTables'

export interface StrokeRecord {
  char: string
  role: 'surname' | 'given'
  stroke: number
}

export interface GridReading {
  number: number
  dayan: DaYanEntry
}

export interface NameGrids {
  tian: GridReading
  ren: GridReading
  di: GridReading
  wai: GridReading
  zong: GridReading
}

export interface PoleReading {
  number: number
  element: ElementName
  yinYang: '阴' | '阳'
}

export interface SancaiNumerology {
  tian: PoleReading
  ren: PoleReading
  di: PoleReading
  /** 天-人-地 五行连写，如 “木水水” */
  triple: string
  grade: SancaiGrade | null
  luckPoint: number | null
}

export interface NameNumerology {
  schemaVersion: 'name-numerology-v1'
  supported: boolean
  unsupportedReason?: 'surname-unrecognized' | 'name-structure-unsupported' | 'stroke-missing'
  /** 缺笔画导致无法成格的用字 */
  missingChars?: string[]
  strokes: StrokeRecord[]
  grids?: NameGrids
  sancai?: SancaiNumerology
  /** 展示口径：传统姓名学数理仅供参考 */
  note: string
}

export interface StrokeLookup {
  (char: string): number | null
}

const NOTE = '以上为传统姓名学五格三才数理，仅供文化参考，不构成命运判断。'
const yinYangForNumber = (number: number): '阴' | '阳' => (number % 2 === 0 ? '阴' : '阳')

const pole = (number: number): PoleReading => ({
  number,
  element: elementForNumber(number),
  yinYang: yinYangForNumber(number),
})

/**
 * 依据 fate 五格公式计算名学数理。f1/f2 为名第一/二字笔画（单字名为 0），
 * l1/l2 为姓第一/二字笔画（单字姓 l2=0）。
 */
function buildGrids(l1: number, l2: number, f1: number, f2: number): NameGrids {
  const tianNumber = l2 === 0 ? l1 + 1 : l1 + l2
  const renNumber = l2 !== 0 ? l2 + f1 : l1 + f1
  const diNumber = f2 === 0 ? f1 + 1 : f1 + f2
  let waiNumber: number
  if (l2 === 0 && f2 === 0) waiNumber = 2
  else if (l2 === 0) waiNumber = 1 + f2
  else if (f2 === 0) waiNumber = l1 + 1
  else waiNumber = l1 + f2
  const zongNumber = ((l1 + l2 + f1 + f2 - 1) % 81) + 1

  return {
    tian: { number: tianNumber, dayan: dayanForNumber(tianNumber) },
    ren: { number: renNumber, dayan: dayanForNumber(renNumber) },
    di: { number: diNumber, dayan: dayanForNumber(diNumber) },
    wai: { number: waiNumber, dayan: dayanForNumber(waiNumber) },
    zong: { number: zongNumber, dayan: dayanForNumber(zongNumber) },
  }
}

function buildSancai(grids: NameGrids): SancaiNumerology {
  const tian = pole(grids.tian.number)
  const ren = pole(grids.ren.number)
  const di = pole(grids.di.number)
  const triple = tian.element + ren.element + di.element
  const grade = sancaiGrade(triple)
  return {
    tian,
    ren,
    di,
    triple,
    grade,
    luckPoint: sancaiLuckPoint(grade),
  }
}

/**
 * 由带笔画的姓名结构生成数理结果（纯函数，便于测试）。
 */
export function buildNameNumerology(strokes: StrokeRecord[]): NameNumerology {
  const surnameStrokes = strokes
    .filter((stroke) => stroke.role === 'surname')
    .map((stroke) => stroke.stroke)
  const givenStrokes = strokes
    .filter((stroke) => stroke.role === 'given')
    .map((stroke) => stroke.stroke)

  if (surnameStrokes.length === 0) {
    return {
      schemaVersion: 'name-numerology-v1',
      supported: false,
      unsupportedReason: 'surname-unrecognized',
      strokes,
      note: NOTE,
    }
  }

  if (surnameStrokes.length > 2 || givenStrokes.length === 0 || givenStrokes.length > 2) {
    return {
      schemaVersion: 'name-numerology-v1',
      supported: false,
      unsupportedReason: 'name-structure-unsupported',
      strokes,
      note: NOTE,
    }
  }

  const missingChars = strokes.filter((stroke) => stroke.stroke < 1).map((stroke) => stroke.char)
  if (missingChars.length > 0) {
    return {
      schemaVersion: 'name-numerology-v1',
      supported: false,
      unsupportedReason: 'stroke-missing',
      missingChars,
      strokes,
      note: NOTE,
    }
  }

  const l1 = surnameStrokes[0]!
  const l2 = surnameStrokes[1] ?? 0
  const f1 = givenStrokes[0]!
  const f2 = givenStrokes[1] ?? 0

  const grids = buildGrids(l1, l2, f1, f2)
  const sancai = buildSancai(grids)

  return {
    schemaVersion: 'name-numerology-v1',
    supported: true,
    strokes,
    grids,
    sancai,
    note: NOTE,
  }
}

let strokeMap: Map<string, number> | null = null
let strokeLoadPromise: Promise<void> | null = null

function strokeDataUrl(): string {
  const locationHref = typeof window !== 'undefined' ? window.location.href : 'http://localhost/'
  return new URL(
    'data/fateStrokes.json',
    new URL(import.meta.env.BASE_URL, locationHref).toString(),
  ).toString()
}

export async function loadStrokeData(): Promise<void> {
  if (strokeMap) return
  if (strokeLoadPromise) return strokeLoadPromise
  strokeLoadPromise = fetch(strokeDataUrl())
    .then(async (response) => {
      if (!response.ok) throw new Error('Fate stroke data failed to load')
      const payload = (await response.json()) as {
        schemaVersion: number
        chars: Record<string, number>
      }
      if (payload.schemaVersion !== 1 || !payload.chars || typeof payload.chars !== 'object') {
        throw new Error('Fate stroke data has an unexpected shape')
      }
      strokeMap = new Map(Object.entries(payload.chars))
    })
    .finally(() => {
      strokeLoadPromise = null
    })
  await strokeLoadPromise
}

export function getScienceStroke(char: string): number | null {
  return strokeMap?.get(char) ?? null
}

/**
 * 分析结果的前置命理计算：输入姓名 → 返回结构化的五格/三才/笔画数据。
 * 笔画数据不可用时返回 null（由调用方隐藏数理面板，不影响基础分析）。
 */
export async function computeNameNumerology(result: AnalyzedName): Promise<NameNumerology | null> {
  try {
    await loadStrokeData()
  } catch {
    return null
  }
  const strokes = result.chars.map(
    (char: AnalyzedChar): StrokeRecord => ({
      char: char.char,
      role: char.role,
      stroke: getScienceStroke(char.char) ?? -1,
    }),
  )
  return buildNameNumerology(strokes)
}
