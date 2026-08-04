import { readFile } from 'node:fs/promises'

const culturalUrl = new URL('../src/data/cultural.json', import.meta.url)
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const cultural = JSON.parse(await readFile(culturalUrl, 'utf8'))
const dictionary = JSON.parse(await readFile(dictionaryUrl, 'utf8'))
const failures = []

function hasMeaningfulDefinition(definition) {
  const trimmed = definition?.trim()
  return Boolean(
    trimmed
    && !/^[\p{P}\p{S}\s]+$/u.test(trimmed)
    && !/(?:暂无中文释义|义未详|字义未详)/u.test(trimmed)
    && !/^(?:形声|会意|象形|指事)(?:。|[()（）]|小篆字形)*$/u.test(trimmed),
  )
}

for (const [char, data] of Object.entries(cultural)) {
  const gloss = data.localGloss?.trim() ?? ''
  const connotation = data.connotation?.trim() ?? ''
  if (!gloss || !connotation) failures.push(`${char}: missing naming meaning`)
  if (/；名字里常取.+的感觉。$/u.test(connotation)) failures.push(`${char}: generated connotation`)
  if (gloss.endsWith('切')) failures.push(`${char}: fanqie notation`)
  if (/^(?:音.{1,4}|反切.*)$/u.test(gloss)) failures.push(`${char}: pronunciation notation`)
  if (/(?:俗|古文).{0,4}字/u.test(gloss)) failures.push(`${char}: variant notation`)
  if (/(?:與|与).{0,4}同/u.test(gloss) || /^同.{1,4}$/u.test(gloss)) {
    failures.push(`${char}: cross-reference notation`)
  }
  if (!hasMeaningfulDefinition(dictionary[char]?.definition_cn)) {
    failures.push(`${char}: missing usable modern dictionary definition`)
  }
}

if (Object.keys(cultural).length < 250) {
  failures.push(`unexpected cultural coverage: ${Object.keys(cultural).length}`)
}

for (const [char, data] of Object.entries(dictionary)) {
  const definition = data.definition_cn?.trim() ?? ''
  if (/^(?:[\p{Unified_Ideograph}〇〆々]{2,}切)+$/u.test(definition)) {
    failures.push(`${char}: dictionary definition contains only fanqie notation`)
  }
}

if (failures.length) {
  throw new Error(`Cultural data quality check failed:\n${failures.slice(0, 50).join('\n')}`)
}

console.log(
  `Validated ${Object.keys(cultural).length} cultural entries and ${Object.keys(dictionary).length} dictionary entries without phonetic-only meanings.`,
)
