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

const source = supplements.source
if (
  source.name !== 'CC-CEDICT'
  || !source.release
  || !source.downloadUrl.startsWith('https://')
  || !/^[a-f0-9]{64}$/u.test(source.sha256)
  || source.license !== 'CC BY-SA 4.0'
) {
  throw new Error('Dictionary supplement source metadata is incomplete.')
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
  if (entry.definition_cn === supplement.definitionCn) continue
  if (hasMeaningfulDefinition(entry.definition_cn)) {
    throw new Error(`${char}: refusing to replace an existing usable definition`)
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
