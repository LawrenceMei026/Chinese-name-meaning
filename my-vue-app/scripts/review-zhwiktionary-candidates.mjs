import { readFile, writeFile } from 'node:fs/promises'

const checkOnly = process.argv.includes('--check')
const queueUrl = new URL('../src/data/zhWiktionaryReviewQueue.json', import.meta.url)
const supplementsUrl = new URL('../src/data/zhWiktionaryDefinitionSupplements.json', import.meta.url)
const outputUrl = new URL('../src/data/zhWiktionaryAutoReview.json', import.meta.url)
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const rejectedUrl = new URL('../src/data/zhWiktionaryRejectedCandidates.json', import.meta.url)

const queue = JSON.parse(await readFile(queueUrl, 'utf8'))
const supplements = JSON.parse(await readFile(supplementsUrl, 'utf8'))
const dictionary = JSON.parse(await readFile(dictionaryUrl, 'utf8'))
const rejectedCandidates = await readFile(rejectedUrl, 'utf8')
  .then(text => JSON.parse(text))
  .catch(error => {
    if (error.code !== 'ENOENT') throw error
    return { source: queue.source, reviewPolicy: { status: 'script_rejected_terminal' }, entries: {} }
  })
let existingOutput = ''
if (checkOnly) existingOutput = await readFile(outputUrl, 'utf8')

const source = queue.source
if (
  source.name !== 'Chinese Wiktionary'
  || source.dumpDate !== '2026-07-01'
  || source.file !== 'zhwiktionary-20260701-pages-articles.xml.bz2'
  || source.sha1 !== '2c866dafae0a95da3850d8e269f0366d1338d418'
  || source.license !== 'CC BY-SA 4.0'
) throw new Error('Chinese Wiktionary review queue source metadata is incomplete or unexpected.')

const reviewed = new Set(Object.entries(supplements.entries)
  .filter(([, entry]) => entry.reviewed === true)
  .map(([char]) => char))
const terminalRejected = new Set(Object.entries(rejectedCandidates.entries)
  .filter(([, entry]) => entry.reviewed === true && entry.reviewMethod === 'script_rejected_terminal')
  .map(([char]) => char))

const blockRules = [
  ['dialect_or_non_mandarin', /(?:dialectal|Cantonese|Hong Kong|slang|colloquial|閩南|闽南|臺灣話|台灣話|粤|粵|吳語|吴语|客家|官話|方言|俚語|俚语)/iu],
  ['proper_name_or_surname', /(?:姓氏|姓|氏族|地名|人名|國名|国名|族名|專名|专名|譯名|译名)/u],
  ['historical_or_classical_only', /(?:歷史|历史|古代|古文|古字|古義|古义|文言|通假|俗字|訛字|讹字|罕用|罕見|罕见)/u],
  ['glyph_or_etymology', /(?:字源|字形|本義|本义|甲骨文|金文|小篆|說文|说文|象形|會意|会意|形聲|形声|指事|部首|筆畫|笔画|異體|异体|反切)/u],
  ['cross_reference', /(?:^同[「“].+[」”]$|^同\p{Unified_Ideograph}$|^見[「“].+[」”]$|^见[「“].+[」”]$|參見|参见|亦作|又作|另見|另见|義同|义同)/u],
  ['measure_or_code', /(?:量詞|量词|計量|计量|單位|单位|編碼|编码|Unicode|碼位|码位)/u],
  ['template_or_markup', /(?:\{\{|\}\}|\[\[|\]\]|<[^>]+>|\|)/u],
]

const cautionRules = [
  ['example_or_usage', /(?:例：|例如|常用用法|用於|用于|只用|多用|泛指|比喻|引申)/u],
  ['domain_limited', /(?:佛教|道教|儒家|醫學|医学|化學|化学|植物|動物|动物|昆蟲|昆虫|天文|音樂|音乐|數學|数学|語法|语法|棋類|棋类)/u],
  ['long_definition', /^.{28,}$/u],
  ['contains_latin', /[A-Za-z]/u],
  ['possible_archaic_wording', /(?:謂|谓|之稱|之称|者|也)$/u],
]

const traditionalToSimplified = new Map(Object.entries({
  內: '内', 裡: '里', 與: '与', 動: '动', 用於: '用于', 紅: '红', 樹: '树', 幹: '干', 歷: '历', 國: '国',
  名: '名', 稱: '称', 開: '开', 間: '间', 適: '适', 於: '于', 階: '阶', 範: '范', 圍: '围', 類: '类',
  聲: '声', 響: '响', 雲: '云', 電: '电', 發: '发', 實: '实', 誠: '诚', 樣: '样', 體: '体', 邊: '边',
  對: '对', 為: '为', 無: '无', 萬: '万', 來: '来', 從: '从', 專: '专', 譯: '译', 異: '异', 參: '参',
  見: '见', 說: '说', 筆: '笔', 畫: '画', 計: '计', 單: '单', 碼: '码', 醫: '医', 學: '学', 數: '数',
  語: '语', 棋: '棋', 長: '长', 極: '极', 變: '变', 質: '质', 溫: '温', 濕: '湿', 龍: '龙', 風: '风',
  馬: '马', 魚: '鱼', 鳥: '鸟', 貝: '贝', 車: '车', 門: '门', 頁: '页', 頭: '头', 飛: '飞', 鄉: '乡',
  華: '华', 東: '东', 廣: '广', 將: '将', 應: '应', 當: '当', 還: '还', 這: '这', 個: '个', 會: '会',
  圓: '圆', 圖: '图', 寶: '宝', 貴: '贵', 豐: '丰', 豔: '艳', 麗: '丽', 潔: '洁', 靜: '静', 輕: '轻',
}))

function simplifyCommon(text) {
  return [...text].map(char => traditionalToSimplified.get(char) ?? char).join('')
}

function unique(items) {
  return [...new Set(items)]
}

function hasUsableNamingDefinition(definition) {
  if (!definition || /(?:会意|形声|象形|指事|小篆字形)/u.test(definition)) return false
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return definition.split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .some(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
}

function cleanDefinition(definition) {
  return simplifyCommon(definition)
    .replace(/（[^）]*(?:dialectal|Cantonese|Hong Kong|slang|方言|俚语)[^）]*）/giu, '')
    .replace(/\([^)]*(?:dialectal|Cantonese|Hong Kong|slang)[^)]*\)/giu, '')
    .replace(/例：.*$/u, '')
    .replace(/例如.*$/u, '')
    .replace(/^\s*[（(][^)）]+[）)]\s*/u, '')
    .replace(/[。.!！?？]+$/u, '')
    .trim()
}

function definitionFragments(definition) {
  return cleanDefinition(definition)
    .split(/[；;，,。.!！?？]/u)
    .map(fragment => fragment.replace(/^\s*(?:指|表示|意为|指的是)\s*/u, '').trim())
    .filter(fragment => fragment.length >= 2 && fragment.length <= 18)
}

function inspectDefinition(definition) {
  const cleaned = cleanDefinition(definition)
  const blockReasons = blockRules
    .filter(([, pattern]) => pattern.test(cleaned) || pattern.test(definition))
    .map(([reason]) => reason)
  const cautions = cautionRules
    .filter(([, pattern]) => pattern.test(cleaned) || pattern.test(definition))
    .map(([reason]) => reason)
  const fragments = definitionFragments(definition)
  const usefulFragments = fragments.filter(fragment => !blockRules.some(([, pattern]) => pattern.test(fragment)))
  const lengthScore = cleaned.length >= 2 && cleaned.length <= 14 ? 18 : cleaned.length <= 28 ? 10 : 0
  const fragmentScore = Math.min(usefulFragments.length, 3) * 12
  const punctuationScore = /[；;，,]/u.test(cleaned) ? 4 : 0
  const score = Math.max(0, lengthScore + fragmentScore + punctuationScore - (blockReasons.length * 35) - (cautions.length * 8))

  return {
    sourceDefinition: definition,
    cleanedDefinition: cleaned,
    accepted: blockReasons.length === 0 && usefulFragments.length > 0 && score >= 18,
    score,
    blockReasons,
    cautions,
    fragments: usefulFragments,
  }
}

function buildDraft(inspections) {
  const fragments = unique(inspections
    .filter(inspection => inspection.accepted)
    .flatMap(inspection => inspection.fragments))
    .slice(0, 3)
  return fragments.join('；')
}

function classify(inspections) {
  const accepted = inspections.filter(inspection => inspection.accepted)
  if (accepted.length === 0) return 'reject'
  const cautions = unique(accepted.flatMap(inspection => inspection.cautions))
  const hasHighScore = accepted.some(inspection => inspection.score >= 34)
  if (hasHighScore && cautions.length === 0) return 'likely_usable'
  return 'manual_review'
}

const entries = {}
const summary = {
  totalCandidates: Object.keys(queue.entries).length,
  reviewedSupplements: reviewed.size,
  terminalRejected: terminalRejected.size,
  dictionaryUsableSkipped: 0,
  evaluatedCandidates: 0,
  likelyUsable: 0,
  manualReview: 0,
  rejected: 0,
}

for (const [char, candidate] of Object.entries(queue.entries)) {
  if (reviewed.has(char)) continue
  if (terminalRejected.has(char)) continue
  if (hasUsableNamingDefinition(dictionary[char]?.definition_cn)) {
    summary.dictionaryUsableSkipped += 1
    continue
  }
  const inspections = candidate.extractedDefinitions.map(inspectDefinition)
  const decision = classify(inspections)
  const accepted = inspections.filter(inspection => inspection.accepted)
  const rejected = inspections.filter(inspection => !inspection.accepted)
  const score = accepted.reduce((total, inspection) => total + inspection.score, 0) - rejected.length * 3
  const draftDefinitionCn = buildDraft(inspections)
  const reasons = unique(inspections.flatMap(inspection => [...inspection.blockReasons, ...inspection.cautions]))

  entries[char] = {
    decision,
    score,
    pageTitle: candidate.pageTitle,
    revisionId: candidate.revisionId,
    timestamp: candidate.timestamp,
    sourceUrl: candidate.sourceUrl,
    suggestedDefinitions: accepted.map(inspection => inspection.sourceDefinition).slice(0, 3),
    draftDefinitionCn,
    reasons,
    rejectedDefinitions: rejected.map(inspection => ({
      sourceDefinition: inspection.sourceDefinition,
      reasons: unique([...inspection.blockReasons, ...inspection.cautions]),
    })),
  }

  summary.evaluatedCandidates += 1
  if (decision === 'likely_usable') summary.likelyUsable += 1
  else if (decision === 'manual_review') summary.manualReview += 1
  else summary.rejected += 1
}

const sortedEntries = Object.fromEntries(Object.entries(entries)
  .sort(([, left], [, right]) => right.score - left.score || left.decision.localeCompare(right.decision)))

const output = {
  source: queue.source,
  reviewPolicy: {
    status: 'automatic_triage_only',
    transformation: 'Unreviewed Chinese Wiktionary candidates are scored for manual review priority. Draft definitions are not production data and must not be applied without human review.',
    decisions: ['likely_usable', 'manual_review', 'reject'],
  },
  summary,
  entries: sortedEntries,
}

const generated = `${JSON.stringify(output, null, 2)}\n`
if (checkOnly) {
  if (generated !== existingOutput) throw new Error('Chinese Wiktionary automatic review report is not up to date.')
  console.log(`Verified automatic review report for ${summary.evaluatedCandidates} Chinese Wiktionary candidates.`)
} else {
  await writeFile(outputUrl, generated)
  console.log(`Reviewed ${summary.evaluatedCandidates} Chinese Wiktionary candidates: ${summary.likelyUsable} likely usable, ${summary.manualReview} manual review, ${summary.rejected} rejected.`)
}
