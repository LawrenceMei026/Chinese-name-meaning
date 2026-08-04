import { readFile, writeFile } from 'node:fs/promises'

const checkOnly = process.argv.includes('--check')
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const supplementsUrl = new URL('../src/data/unihanDefinitionSupplements.json', import.meta.url)
const dictionaryText = await readFile(dictionaryUrl, 'utf8')
const dictionary = JSON.parse(dictionaryText)
const supplements = JSON.parse(await readFile(supplementsUrl, 'utf8'))

function hasUsableNamingDefinition(definition) {
  if (!definition || /(?:会意|形声|象形|指事|小篆字形|暂无中文释义|义未详|字义未详)/u.test(definition)) return false
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return definition.split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .some(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
}

if (
  supplements.source.name !== 'Unicode Unihan'
  || supplements.source.version !== '17.0.0'
  || supplements.source.field !== 'kDefinition'
  || supplements.source.license !== 'Unicode License V3'
  || !/^[a-f0-9]{64}$/u.test(supplements.source.sha256)
) throw new Error('Unihan supplement source metadata is incomplete.')

let changed = 0
for (const [char, supplement] of Object.entries(supplements.entries)) {
  const entry = dictionary[char]
  if (!entry) throw new Error(`${char}: target character is missing from chars.json`)
  if (supplement.reviewed !== true) throw new Error(`${char}: Unihan supplement has not been reviewed`)
  if (!supplement.sourceDefinition.trim()) throw new Error(`${char}: source definition is missing`)
  if (!hasUsableNamingDefinition(supplement.definitionCn)) throw new Error(`${char}: definition is not usable for naming inference`)
  if (entry.definition_cn === supplement.definitionCn) continue
  if (hasUsableNamingDefinition(entry.definition_cn)) throw new Error(`${char}: refusing to replace an existing naming-usable definition`)
  entry.definition_cn = supplement.definitionCn
  changed += 1
}

const generated = `${JSON.stringify(dictionary, null, 2)}\n`
if (checkOnly) {
  if (changed > 0 || generated !== dictionaryText) throw new Error(`Unihan supplements are not applied (${changed} definitions differ).`)
  console.log(`Verified ${Object.keys(supplements.entries).length} reviewed Unihan supplements.`)
} else {
  await writeFile(dictionaryUrl, generated)
  console.log(`Applied ${changed} of ${Object.keys(supplements.entries).length} reviewed Unihan supplements.`)
}
