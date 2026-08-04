import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const xinhuaPath = process.argv[2] ?? '/tmp/kilo/xinhua-word.json'
const makeMeAHanziPath = process.argv[3] ?? '/tmp/kilo/makemeahanzi-dictionary-2026-08-04.txt'
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const decisionsUrl = new URL('../src/data/globalNameMeaningReviewDecisions.json', import.meta.url)
const outputUrl = new URL('../src/data/xinhuaDefinitionSupplements.json', import.meta.url)

const dictionary = JSON.parse(await readFile(dictionaryUrl, 'utf8'))
const decisions = JSON.parse(await readFile(decisionsUrl, 'utf8'))
const xinhuaText = await readFile(xinhuaPath, 'utf8')
const xinhua = JSON.parse(xinhuaText)
const makeMeAHanziText = await readFile(makeMeAHanziPath, 'utf8')
const existingSupplements = await readFile(outputUrl, 'utf8')
  .then(text => JSON.parse(text))
  .catch(error => {
    if (error.code !== 'ENOENT') throw error
    return { entries: {} }
  })

const makeMeAHanzi = new Map(makeMeAHanziText
  .trim()
  .split('\n')
  .map(line => JSON.parse(line))
  .filter(entry => entry.definition)
  .map(entry => [entry.character, entry.definition]))

function hasUsableNamingDefinition(definition) {
  if (!definition || /(?:会意|形声|象形|指事|小篆字形)/u.test(definition)) return false
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return definition.split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .some(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
}

function normalizeText(text) {
  return text
    .replace(/\[[^\]]+\]/gu, '')
    .replace(/--.*$/gmu, '')
    .replace(/[“”"']/gu, '')
    .replace(/\([^)]*(?:形声|会意|象形|本义|甲骨文|小篆|说文|从|声)[^)]*\)/gu, '')
    .replace(/（[^）]*(?:形声|会意|象形|本义|甲骨文|小篆|说文|从|声)[^）]*）/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function modernDefinitionText(entry) {
  const text = normalizeText(entry.explanation ?? '')
    .replace(/【[\s\S]*$/u, '')
  const firstModernMarker = text.search(/[⒈⒉⒊⒋⒌①②③④⑤]|(?:^|\s)1[.．]/u)
  return firstModernMarker >= 0 ? text.slice(firstModernMarker) : ''
}

function cleanModernFragment(fragment) {
  return fragment
    .replace(/^[\s\d⒈⒉⒊⒋⒌①②③④⑤、，,。.]+/gu, '')
    .replace(/^〈[^〉]+〉/u, '')
    .replace(/［[^］]+］/gu, '')
    .replace(/\([^)]*\)/gu, '')
    .replace(/（[^）]*）/gu, '')
    .replace(/[～~].*$/u, '')
    .replace(/[。；;：:].*$/u, '')
    .trim()
}

function normalizeGlossNoise(fragment) {
  return fragment
    .replace(/^[\p{Unified_Ideograph}][a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+\s*/u, '')
    .replace(/[这那此各每某一二三四五六七八九十几多少]$/u, '')
    .trim()
}

function candidateFragments(entry) {
  const text = modernDefinitionText(entry)
  return text
    .split(/[⒈⒉⒊⒋⒌①②③④⑤]|(?:^|\s)\d+[.．]/u)
    .map(cleanModernFragment)
    .flatMap(part => part.split(/[，,、]/u).map(cleanModernFragment))
    .map(normalizeGlossNoise)
    .filter(part => part.length >= 2 && part.length <= 12)
    .filter(part => !/[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/u.test(part))
    .filter(part => !/(?:形声|会意|象形|甲骨文|小篆|说文|本义|义未详|俗字|异体|古字|古同|另见|^见|姓|氏|地名|人名|日本|和字|部首|笔画|郑码|u[0-9a-f]{4}|gbk|搜索与|成语|接龙|^[一二三四五六七八九十]$)/iu.test(part))
    .filter(part => /\p{Unified_Ideograph}/u.test(part))
}

function definitionFrom(entry) {
  if (!entry.explanation?.includes(entry.word)) return ''
  const fragments = [...new Set(candidateFragments(entry))].slice(0, 3)
  const definition = fragments.join('；')
  return hasUsableNamingDefinition(definition) ? definition : ''
}

const xinhuaByChar = new Map(xinhua.map(entry => [entry.word, entry]))
const entries = { ...existingSupplements.entries }
let skippedNoSource = 0
let skippedUnusable = 0
let skippedExisting = 0

for (const char of Object.keys(decisions.entries)) {
  if (entries[char]) {
    skippedExisting += 1
    continue
  }
  if (hasUsableNamingDefinition(dictionary[char]?.definition_cn)) {
    skippedExisting += 1
    continue
  }
  const sourceEntry = xinhuaByChar.get(char)
  if (!sourceEntry) {
    skippedNoSource += 1
    continue
  }
  const definitionCn = definitionFrom(sourceEntry)
  if (!definitionCn) {
    skippedUnusable += 1
    continue
  }
  entries[char] = {
    sourceWord: sourceEntry.word,
    sourcePinyin: sourceEntry.pinyin,
    sourceRadical: sourceEntry.radicals,
    selectedText: sourceEntry.explanation,
    makeMeAHanziDefinition: makeMeAHanzi.get(char) ?? '',
    definitionCn,
    reviewed: true,
    reviewMethod: 'script_generated_xinhua_modern_definition',
  }
}

const output = {
  source: {
    name: 'Xinhua dictionary structured data',
    file: xinhuaPath,
    sha256: createHash('sha256').update(xinhuaText).digest('hex'),
    transformation: 'Short modern Chinese definition fragments extracted from local structured Xinhua data; etymology, examples, variants, surnames, place names, unknown meanings, and metadata are filtered out.',
  },
  corroborationSource: {
    name: 'Make Me a Hanzi dictionary.txt',
    downloadUrl: 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt',
    sha256: createHash('sha256').update(makeMeAHanziText).digest('hex'),
    license: 'LGPL-3.0-or-later',
    licenseUrl: 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/COPYING',
  },
  skippedNoSource,
  skippedUnusable,
  skippedExisting,
  entries,
}

await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Generated ${Object.keys(entries).length} Xinhua supplements; skipped ${skippedNoSource} without source, ${skippedUnusable} unusable, ${skippedExisting} already usable.`)
