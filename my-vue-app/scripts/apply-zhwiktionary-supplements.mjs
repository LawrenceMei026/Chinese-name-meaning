import { readFile, writeFile } from 'node:fs/promises'

const checkOnly = process.argv.includes('--check')
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const supplementsUrl = new URL('../src/data/zhWiktionaryDefinitionSupplements.json', import.meta.url)
const queueUrl = new URL('../src/data/zhWiktionaryReviewQueue.json', import.meta.url)
const dictionaryText = await readFile(dictionaryUrl, 'utf8')
const dictionary = JSON.parse(dictionaryText)
const supplements = JSON.parse(await readFile(supplementsUrl, 'utf8'))
const queue = JSON.parse(await readFile(queueUrl, 'utf8'))

function hasUsableNamingDefinition(definition) {
  if (!definition || /(?:会意|形声|象形|指事|小篆字形)/u.test(definition)) return false
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return definition.split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .some(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
}

const source = supplements.source
if (
  source.name !== 'Chinese Wiktionary'
  || source.dumpDate !== '2026-07-01'
  || source.file !== queue.source.file
  || source.sha1 !== queue.source.sha1
  || !/^[a-f0-9]{40}$/u.test(source.sha1)
  || source.license !== 'CC BY-SA 4.0'
) throw new Error('Chinese Wiktionary source metadata is incomplete or does not match the review queue.')

let changed = 0
for (const [char, supplement] of Object.entries(supplements.entries)) {
  const candidate = queue.entries[char]
  const entry = dictionary[char]
  if (!candidate || !entry) throw new Error(`${char}: source candidate or dictionary entry is missing`)
  if (supplement.reviewed !== true) throw new Error(`${char}: Chinese definition has not been reviewed`)
  if (
    supplement.revisionId !== candidate.revisionId
    || supplement.timestamp !== candidate.timestamp
    || supplement.sourceUrl !== candidate.sourceUrl
  ) {
    throw new Error(`${char}: source revision does not match the fixed review queue`)
  }
  if (!supplement.selectedDefinitions.every(definition => candidate.extractedDefinitions.includes(definition))) {
    throw new Error(`${char}: a selected definition is absent from the fixed source revision`)
  }
  if (!hasUsableNamingDefinition(supplement.definitionCn)) {
    throw new Error(`${char}: reviewed Chinese definition is not usable for naming inference`)
  }
  if (entry.definition_cn === supplement.definitionCn) continue
  if (hasUsableNamingDefinition(entry.definition_cn)) {
    throw new Error(`${char}: refusing to replace an existing naming-usable definition`)
  }
  entry.definition_cn = supplement.definitionCn
  changed += 1
}

const generated = `${JSON.stringify(dictionary, null, 2)}\n`
if (checkOnly) {
  if (changed > 0 || generated !== dictionaryText) {
    throw new Error(`Chinese Wiktionary supplements are not applied (${changed} definitions differ).`)
  }
  console.log(`Verified ${Object.keys(supplements.entries).length} reviewed Chinese Wiktionary supplements.`)
} else {
  await writeFile(dictionaryUrl, generated)
  console.log(`Applied ${changed} of ${Object.keys(supplements.entries).length} reviewed Chinese Wiktionary supplements.`)
}
