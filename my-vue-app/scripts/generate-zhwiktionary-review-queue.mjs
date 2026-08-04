import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { extractModernChineseDefinitions } from './lib/zhwiktionary-parser.mjs'

const dumpPath = process.argv[2]
if (!dumpPath) throw new Error('Usage: node scripts/generate-zhwiktionary-review-queue.mjs <pages-articles.xml.bz2>')

const DUMP_DATE = '2026-07-01'
const DUMP_FILE = 'zhwiktionary-20260701-pages-articles.xml.bz2'
const DUMP_SHA1 = '2c866dafae0a95da3850d8e269f0366d1338d418'
const dictionary = JSON.parse(await readFile(new URL('../public/data/chars.json', import.meta.url), 'utf8'))
const cultural = JSON.parse(await readFile(new URL('../src/data/cultural.json', import.meta.url), 'utf8'))
const outputUrl = new URL('../src/data/zhWiktionaryReviewQueue.json', import.meta.url)

function hasUsableCulturalData(data) {
  const gloss = data?.localGloss?.trim() ?? ''
  const connotation = data?.connotation?.trim() ?? ''
  return Boolean(gloss) && Boolean(connotation)
    && !/；名字里常取.+的感觉。$/u.test(connotation)
    && !gloss.endsWith('切')
    && !/^(?:音.{1,4}|反切.*)$/u.test(gloss)
    && !/(?:俗|古文).{0,4}字/u.test(gloss)
    && !/(?:與|与).{0,4}同/u.test(gloss)
    && !/^同.{1,4}$/u.test(gloss)
}

function hasMeaningfulDefinition(definition) {
  const trimmed = definition?.trim()
  return Boolean(trimmed)
    && !/^[\p{P}\p{S}\s]+$/u.test(trimmed)
    && !/(?:暂无中文释义|义未详|字义未详)/u.test(trimmed)
    && !/^(?:形声|会意|象形|指事)(?:。|[()（）]|小篆字形)*$/u.test(trimmed)
}

function cleanDefinition(text) {
  if (!text || /(?:会意|形声|象形|指事|小篆字形)/u.test(text)) return ''
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return text.replace(/^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s\d]+/u, '')
    .split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .find(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment)) ?? ''
}

function decodeXml(text) {
  return text.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/giu, (_, name, decimal, hex) => {
    if (decimal) return String.fromCodePoint(Number(decimal))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name]
  })
}

const pending = new Set(Object.entries(dictionary)
  .filter(([char, entry]) => {
    const codePoint = char.codePointAt(0)
    if ([...char].length !== 1 || codePoint < 0x4e00 || codePoint > 0x9fa5) return false
    const definition = hasMeaningfulDefinition(entry.definition_cn) ? entry.definition_cn : ''
    return !hasUsableCulturalData(cultural[char]) && !cleanDefinition(definition)
  })
  .map(([char]) => char))

const dump = await readFile(dumpPath)
const sha1 = createHash('sha1').update(dump).digest('hex')
if (sha1 !== DUMP_SHA1) throw new Error(`Chinese Wiktionary dump SHA-1 mismatch: ${sha1}`)

const decompressor = spawn('bzip2', ['-dc', dumpPath])
decompressor.stderr.pipe(process.stderr)
decompressor.stdout.setEncoding('utf8')
const entries = {}
let buffer = ''
for await (const chunk of decompressor.stdout) {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('</page>')) >= 0) {
    const page = buffer.slice(0, end + 7)
    buffer = buffer.slice(end + 7)
    const title = decodeXml(page.match(/<title>([\s\S]*?)<\/title>/u)?.[1] ?? '')
    if (!pending.has(title) || !/<ns>0<\/ns>/u.test(page)) continue
    const revision = page.match(/<revision>([\s\S]*?)<\/revision>/u)?.[1] ?? ''
    const revisionId = Number(revision.match(/<id>(\d+)<\/id>/u)?.[1] ?? 0)
    const timestamp = revision.match(/<timestamp>([^<]+)<\/timestamp>/u)?.[1] ?? ''
    const wikitext = decodeXml(revision.match(/<text\b[^>]*>([\s\S]*?)<\/text>/u)?.[1] ?? '')
    const definitions = extractModernChineseDefinitions(wikitext)
    if (definitions.length === 0) continue
    entries[title] = {
      pageTitle: title,
      revisionId,
      timestamp,
      sourceUrl: `https://zh.wiktionary.org/w/index.php?title=${encodeURIComponent(title)}&oldid=${revisionId}`,
      extractedDefinitions: definitions,
      reviewed: false,
    }
  }
}
const exitCode = await new Promise(resolve => decompressor.on('close', resolve))
if (exitCode !== 0) throw new Error(`bzip2 exited with code ${exitCode}`)

const output = {
  source: {
    name: 'Chinese Wiktionary',
    dumpDate: DUMP_DATE,
    file: DUMP_FILE,
    downloadUrl: `https://dumps.wikimedia.org/zhwiktionary/${DUMP_DATE.replaceAll('-', '')}/${DUMP_FILE}`,
    sha1: DUMP_SHA1,
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    transformation: 'Modern Chinese definition candidates extracted from single-character pages; pronunciation, etymology, variants, translations, examples, and non-Chinese sections are excluded. Every record remains unreviewed until selected manually.',
  },
  pendingCharacters: pending.size,
  candidateCharacters: Object.keys(entries).length,
  entries,
}
await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Generated ${output.candidateCharacters} Chinese Wiktionary candidates from ${pending.size} pending characters.`)
