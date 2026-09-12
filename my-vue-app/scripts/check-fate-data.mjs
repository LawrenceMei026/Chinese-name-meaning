// 校验 public/data/fateStrokes.json 的结构与覆盖情况。
// 生成脚本见 scripts/build-fate-stroke-data.mjs。
import { readFile } from 'node:fs/promises'

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

const payload = JSON.parse(
  await readFile(new URL('../public/data/fateStrokes.json', import.meta.url), 'utf8'),
)

if (payload.schemaVersion !== 1) {
  throw new Error(`fateStrokes.json schemaVersion 应为 1，收到 ${payload.schemaVersion}`)
}

const chars = payload.chars
if (!chars || typeof chars !== 'object' || Array.isArray(chars)) {
  throw new Error('fateStrokes.json 缺少 chars 对象')
}

const entries = Object.entries(chars)
if (entries.length === 0) throw new Error('fateStrokes.json 的 chars 为空')
for (const [char, stroke] of entries) {
  if ([...char].length !== 1) throw new Error(`非法汉字键：${char}`)
  if (!Number.isInteger(stroke) || stroke <= 0 || stroke > 60) {
    throw new Error(`非法的笔画值：${char}=${stroke}`)
  }
}

const singleSurnames = Object.keys(
  JSON.parse(await readFile(new URL('../public/data/surnames.json', import.meta.url), 'utf8')),
)
const culturalChars = Object.keys(
  JSON.parse(await readFile(new URL('../src/data/cultural.json', import.meta.url), 'utf8')),
)
const compoundChars = [...new Set(COMMON_COMPOUND_SURNAMES.join(''))]

const missingSingleSurname = singleSurnames.filter((char) => chars[char] === undefined)
const missingCultural = culturalChars.filter((char) => chars[char] === undefined)
const missingCompound = compoundChars.filter((char) => chars[char] === undefined)

if (missingCompound.length > 0) {
  throw new Error(`复姓组成字缺少姓名学笔画：${missingCompound.join('')}`)
}

console.log(`fateStrokes.json 通过校验：${entries.length} 字`)
console.log(
  `缺失单字姓（${missingSingleSurname.length}）：${missingSingleSurname.join('') || '无'}`,
)
console.log(`缺失文化字（${missingCultural.length}）：${missingCultural.join('') || '无'}`)
