import { readFile, writeFile } from 'node:fs/promises'

const supplementsUrl = new URL('../src/data/zhWiktionaryDefinitionSupplements.json', import.meta.url)
const queueUrl = new URL('../src/data/zhWiktionaryReviewQueue.json', import.meta.url)
const autoReviewUrl = new URL('../src/data/zhWiktionaryAutoReview.json', import.meta.url)
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)

const supplements = JSON.parse(await readFile(supplementsUrl, 'utf8'))
const queue = JSON.parse(await readFile(queueUrl, 'utf8'))
const autoReview = JSON.parse(await readFile(autoReviewUrl, 'utf8'))
const dictionary = JSON.parse(await readFile(dictionaryUrl, 'utf8'))

function hasUsableNamingDefinition(definition) {
  if (!definition || /(?:会意|形声|象形|指事|小篆字形)/u.test(definition)) return false
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return definition.split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .some(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
}

if (
  supplements.source.name !== queue.source.name
  || supplements.source.dumpDate !== queue.source.dumpDate
  || supplements.source.file !== queue.source.file
  || supplements.source.sha1 !== queue.source.sha1
  || supplements.source.license !== queue.source.license
) throw new Error('Chinese Wiktionary supplements and review queue source metadata do not match.')

if (
  autoReview.source.name !== queue.source.name
  || autoReview.source.dumpDate !== queue.source.dumpDate
  || autoReview.source.file !== queue.source.file
  || autoReview.source.sha1 !== queue.source.sha1
  || autoReview.source.license !== queue.source.license
  || autoReview.reviewPolicy?.status !== 'automatic_triage_only'
) throw new Error('Chinese Wiktionary automatic review report is missing fixed source metadata.')

let removedPreviousAuto = 0
for (const [char, supplement] of Object.entries(supplements.entries)) {
  if (supplement.reviewMethod === 'automatic_review_script') {
    delete supplements.entries[char]
    removedPreviousAuto += 1
  }
}

let imported = 0
let skippedExisting = 0
let skippedUsableDefinition = 0
for (const [char, review] of Object.entries(autoReview.entries)) {
  if (review.decision !== 'likely_usable') continue
  if (supplements.entries[char]) {
    skippedExisting += 1
    continue
  }
  if (hasUsableNamingDefinition(dictionary[char]?.definition_cn) && dictionary[char]?.definition_cn !== review.draftDefinitionCn) {
    skippedUsableDefinition += 1
    continue
  }

  const candidate = queue.entries[char]
  if (!candidate) throw new Error(`${char}: source candidate is missing from the review queue`)
  if (
    review.revisionId !== candidate.revisionId
    || review.timestamp !== candidate.timestamp
    || review.sourceUrl !== candidate.sourceUrl
  ) throw new Error(`${char}: automatic review source revision does not match the fixed queue`)
  if (!review.draftDefinitionCn?.trim()) throw new Error(`${char}: automatic review has no draft definition`)
  if (!review.suggestedDefinitions.every(definition => candidate.extractedDefinitions.includes(definition))) {
    throw new Error(`${char}: automatic review selected a definition absent from the fixed source revision`)
  }

  supplements.entries[char] = {
    revisionId: candidate.revisionId,
    timestamp: candidate.timestamp,
    sourceUrl: candidate.sourceUrl,
    selectedDefinitions: review.suggestedDefinitions,
    definitionCn: review.draftDefinitionCn,
    reviewed: true,
    reviewMethod: 'automatic_review_script',
  }
  imported += 1
}

await writeFile(supplementsUrl, `${JSON.stringify(supplements, null, 2)}\n`)
console.log(`Imported ${imported} automatic Chinese Wiktionary supplements; removed ${removedPreviousAuto} previous automatic entries, skipped ${skippedExisting} existing reviewed entries and ${skippedUsableDefinition} dictionary entries with usable definitions.`)
