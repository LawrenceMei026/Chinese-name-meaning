import { readFile, writeFile } from 'node:fs/promises'

const checkOnly = process.argv.includes('--check')
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const supplementsUrl = new URL('../src/data/ccCedictDefinitionSupplements.json', import.meta.url)
const dictionaryText = await readFile(dictionaryUrl, 'utf8')
const dictionary = JSON.parse(dictionaryText)
const supplements = JSON.parse(await readFile(supplementsUrl, 'utf8'))

function hasMeaningfulDefinition(definition) {
  const trimmed = definition?.trim()
  return Boolean(
    trimmed
    && !/^[\p{P}\p{S}\s]+$/u.test(trimmed)
    && !/(?:暂无中文释义|义未详|字义未详)/u.test(trimmed)
    && !/^(?:形声|会意|象形|指事)(?:。|[()（）]|小篆字形)*$/u.test(trimmed),
  )
}

function hasUsableNamingDefinition(definition) {
  if (!definition || /(?:会意|形声|象形|指事|小篆字形)/u.test(definition)) return false
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return definition
    .split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .some(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
}

const source = supplements.source
const corroborationSource = supplements.corroborationSource
if (
  source.name !== 'CC-CEDICT'
  || !source.release
  || !source.downloadUrl.startsWith('https://')
  || !/^[a-f0-9]{64}$/u.test(source.sha256)
  || source.license !== 'CC BY-SA 4.0'
) {
  throw new Error('Dictionary supplement source metadata is incomplete.')
}
if (
  Object.values(supplements.entries).some(entry => 'unihanDefinition' in entry)
  && (
    corroborationSource?.name !== 'Unicode Unihan'
    || corroborationSource.version !== '17.0.0'
    || !/^[a-f0-9]{64}$/u.test(corroborationSource.sha256)
    || corroborationSource.field !== 'kDefinition'
    || corroborationSource.license !== 'Unicode License V3'
  )
) {
  throw new Error('Dictionary corroboration source metadata is incomplete.')
}

let changed = 0
for (const [char, supplement] of Object.entries(supplements.entries)) {
  const entry = dictionary[char]
  if (!entry) throw new Error(`${char}: target character is missing from chars.json`)
  if ([...char].length !== 1) throw new Error(`${char}: supplement key must be one character`)
  if (supplement.reviewed !== true) throw new Error(`${char}: translation has not been reviewed`)
  if (!supplement.raw.includes(` ${char} [`)) throw new Error(`${char}: raw CC-CEDICT line does not match key`)
  if (!Array.isArray(supplement.glosses) || supplement.glosses.length === 0) {
    throw new Error(`${char}: source glosses are missing`)
  }
  if (!supplement.glosses.every(gloss => supplement.raw.includes(gloss))) {
    throw new Error(`${char}: a selected gloss is absent from the raw CC-CEDICT line`)
  }
  if (!hasMeaningfulDefinition(supplement.definitionCn)) {
    throw new Error(`${char}: reviewed Chinese definition is not usable`)
  }
  if (!hasUsableNamingDefinition(supplement.definitionCn)) {
    throw new Error(`${char}: reviewed Chinese definition is not usable for naming inference`)
  }
  if ('unihanDefinition' in supplement && !supplement.unihanDefinition.trim()) {
    throw new Error(`${char}: Unihan corroborating definition is missing`)
  }
  if (entry.definition_cn === supplement.definitionCn) continue
  const replacesReviewedDefinition = supplement.replaces?.includes(entry.definition_cn) ?? false
  if (hasUsableNamingDefinition(entry.definition_cn) && !replacesReviewedDefinition) {
    throw new Error(`${char}: refusing to replace an existing naming-usable definition`)
  }
  entry.definition_cn = supplement.definitionCn
  changed += 1
}

const generated = `${JSON.stringify(dictionary, null, 2)}\n`
if (checkOnly) {
  if (changed > 0 || generated !== dictionaryText) {
    throw new Error(`Dictionary supplements are not applied (${changed} definitions differ).`)
  }
  console.log(`Verified ${Object.keys(supplements.entries).length} reviewed CC-CEDICT supplements.`)
} else {
  await writeFile(dictionaryUrl, generated)
  console.log(`Applied ${changed} of ${Object.keys(supplements.entries).length} reviewed CC-CEDICT supplements.`)
}
