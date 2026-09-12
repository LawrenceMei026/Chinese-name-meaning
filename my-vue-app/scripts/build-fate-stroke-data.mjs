// 从 github.com/babyname/fate (MIT) 的 resources/character.json 抽取常用字的
// 姓名学笔画，生成 public/data/fateStrokes.json。
//
// 用法：
//   node scripts/build-fate-stroke-data.mjs <fate-character.json 路径>
// 该源文件可从以下地址下载（约 12MB）：
//   https://raw.githubusercontent.com/babyname/fate/main/resources/character.json
//
// 每个汉字取 science_stroke（姓名学笔画，已含部首变形修正），缺失时依次回退到
// kangxi_stroke / traditional_stroke / simplified_stroke。覆盖集合为：
//   1) 全部单字姓（public/data/surnames.json）
//   2) 常见复姓组成字
//   3) 文化字库全部字（src/data/cultural.json）
//   4) 本应用内置字典（public/data/chars.json）收录的 nameable 汉字
// 生成结果会随仓库提交；校验见 scripts/check-fate-data.mjs。

import { readFile, writeFile } from 'node:fs/promises'

// 与 src/services/nameAnalyzer.ts 中 COMMON_COMPOUND_SURNAMES 保持一致。
const COMMON_COMPOUND_SURNAMES = [
  '欧阳',
  '司徒',
  '上官',
  '诸葛',
  '司马',
  '夏侯',
  '令狐',
  '皇甫',
  '宇文',
  '慕容',
  '尉迟',
  '长孙',
  '公孙',
  '东郭',
  '南宫',
  '闾丘',
  '子车',
  '百里',
  '梁丘',
  '东门',
  '西门',
  '呼延',
  '公羊',
  '轩辕',
  '濮阳',
  '单于',
  '申屠',
  '仲孙',
  '钟离',
  '东里',
  '谷梁',
  '拓跋',
  '夹谷',
  '段干',
  '漆雕',
  '乐正',
  '壤驷',
  '公良',
  '漆周',
  '东野',
  '宰父',
  '端木',
  '巫马',
  '公西',
  '颛孙',
  '壤丘',
  '微生',
  '羊舌',
  '万俟',
  '闻人',
  '东方',
  '赫连',
  '澹台',
  '公冶',
  '宗政',
  '淳于',
  '太叔',
  '鲜于',
  '司空',
  '司寇',
  '亓官',
  '左丘',
  '南门',
  '归海',
  '第五',
]

const sourcePath = process.argv[2]
if (!sourcePath) {
  console.error('用法：node scripts/build-fate-stroke-data.mjs <fate character.json 路径>')
  process.exit(1)
}

const [sourceText, surnamesRaw, culturalRaw, charsRaw] = await Promise.all([
  readFile(sourcePath, 'utf8'),
  readFile(new URL('../public/data/surnames.json', import.meta.url), 'utf8'),
  readFile(new URL('../src/data/cultural.json', import.meta.url), 'utf8'),
  readFile(new URL('../public/data/chars.json', import.meta.url), 'utf8'),
])

const sourceRecords = JSON.parse(sourceText)
if (!Array.isArray(sourceRecords)) throw new Error('fate character.json 应为数组')

const singleSurnames = Object.keys(JSON.parse(surnamesRaw))
const culturalChars = Object.keys(JSON.parse(culturalRaw))
const compoundChars = [...new Set(COMMON_COMPOUND_SURNAMES.join(''))]
// 本应用内置字典收录的汉字，作为“输入可能出现的常用字”范围。
const bundledChars = new Set(Object.keys(JSON.parse(charsRaw)))

const required = new Set([...singleSurnames, ...culturalChars, ...compoundChars])

// 单个汉字可能有简体/繁体/异体等多条记录，按优先级取姓名学笔画。
function pickStroke(record) {
  if (typeof record !== 'object' || record === null) return null
  const value =
    record.science_stroke ??
    record.kangxi_stroke ??
    record.traditional_stroke ??
    record.simplified_stroke
  return Number.isInteger(value) && value > 0 ? value : null
}

const byChar = new Map()
for (const record of sourceRecords) {
  const char = typeof record.char === 'string' ? record.char : ''
  if (!char || [...char].length !== 1) continue
  const priority = record.is_variant ? 2 : record.is_simplified && !record.is_traditional ? 0 : 1
  const existing = byChar.get(char)
  if (existing === undefined || priority < existing.priority) {
    const stroke = pickStroke(record)
    if (stroke !== null) byChar.set(char, { stroke, priority })
  }
}

function lookup(char) {
  return byChar.get(char)?.stroke ?? null
}

const output = {}
const missingRequired = []
for (const char of [...required].sort()) {
  const stroke = lookup(char)
  if (stroke === null) {
    missingRequired.push(char)
    continue
  }
  output[char] = stroke
}

// 常用字：应用内置字典出现、且源库 nameable 的汉字，补齐现代常用名用字。
for (const record of sourceRecords) {
  if (record.nameable === false) continue
  const char = typeof record.char === 'string' ? record.char : ''
  if (!char || [...char].length !== 1 || output[char] !== undefined) continue
  if (!bundledChars.has(char)) continue
  const stroke = pickStroke(record)
  if (stroke !== null) output[char] = stroke
}

const chars = Object.keys(output)
chars.sort()
const sorted = {}
for (const char of chars) sorted[char] = output[char]

const singleSurnameMissing = [...singleSurnames].filter((char) => sorted[char] === undefined)
const culturalMissing = culturalChars.filter((char) => sorted[char] === undefined)
const compoundMissing = compoundChars.filter((char) => sorted[char] === undefined)

await writeFile(
  new URL('../public/data/fateStrokes.json', import.meta.url),
  JSON.stringify({ schemaVersion: 1, chars: sorted }, null, 0) + '\n',
  'utf8',
)

console.log(`源记录数：${sourceRecords.length}；生成笔画字表：${chars.length} 字`)
console.log(
  `缺失单字姓（${singleSurnameMissing.length}）：${singleSurnameMissing.join('') || '无'}`,
)
console.log(`缺失文化字（${culturalMissing.length}）：${culturalMissing.join('') || '无'}`)
console.log(`缺失复姓组成字（${compoundMissing.length}）：${compoundMissing.join('') || '无'}`)
if (culturalMissing.length > 0 || compoundMissing.length > 0) {
  console.warn('提示：以上字不在数据源中。输入含此类字的姓名时，数理格将按"缺笔画"优雅降级。')
}
