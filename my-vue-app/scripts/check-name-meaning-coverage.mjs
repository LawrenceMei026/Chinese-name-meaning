import { readFile } from 'node:fs/promises'

const dictionary = JSON.parse(await readFile(new URL('../public/data/chars.json', import.meta.url), 'utf8'))
const cultural = JSON.parse(await readFile(new URL('../src/data/cultural.json', import.meta.url), 'utf8'))
const reviewDecisions = await readFile(new URL('../src/data/globalNameMeaningReviewDecisions.json', import.meta.url), 'utf8')
  .then(text => JSON.parse(text))
  .catch(error => {
    if (error.code !== 'ENOENT') throw error
    return { entries: {} }
  })

function hasUsableCulturalData(data) {
  const gloss = data?.localGloss?.trim() ?? ''
  const connotation = data?.connotation?.trim() ?? ''
  return Boolean(gloss)
    && Boolean(connotation)
    && !/；名字里常取.+的感觉。$/u.test(connotation)
    && !gloss.endsWith('切')
    && !/^(?:音.{1,4}|反切.*)$/u.test(gloss)
    && !/(?:俗|古文).{0,4}字/u.test(gloss)
    && !/(?:與|与).{0,4}同/u.test(gloss)
    && !/^同.{1,4}$/u.test(gloss)
}

function cleanDefinition(text) {
  if (!text || /(?:会意|形声|象形|指事|小篆字形)/u.test(text)) return ''
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return text
    .replace(/^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s\d]+/u, '')
    .split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .find(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment)) ?? ''
}

function hasMeaningfulDefinition(definition) {
  const trimmed = definition?.trim()
  return Boolean(
    trimmed
    && !/^[\p{P}\p{S}\s]+$/u.test(trimmed)
    && !/(?:暂无中文释义|义未详|字义未详)/u.test(trimmed)
    && !/^(?:形声|会意|象形|指事)(?:。|[()（）]|小篆字形)*$/u.test(trimmed),
  )
}

const reachable = Object.entries(dictionary).filter(([char]) => {
  const codePoint = char.codePointAt(0)
  return [...char].length === 1 && codePoint >= 0x4e00 && codePoint <= 0x9fa5
})
const missing = reachable.filter(([char, entry]) => {
  const culture = cultural[char]
  const definition = hasMeaningfulDefinition(entry.definition_cn) ? entry.definition_cn : ''
  return !hasUsableCulturalData(culture) && !cleanDefinition(definition)
})
const pending = missing.filter(([char]) => reviewDecisions.entries[char]?.reviewed !== true)

if (pending.length > 5_408) {
  throw new Error(`Naming-meaning coverage regressed: at most 5408 pending characters are allowed, found ${pending.length}.`)
}
for (const char of ['素', '琴']) {
  if (pending.some(([candidate]) => candidate === char)) {
    throw new Error(`${char}: reviewed Zhang Suqin definition is not usable for naming inference.`)
  }
}

console.log(`Audited ${reachable.length} reachable characters: ${reachable.length - missing.length} naming-usable, ${missing.length - pending.length} terminally reviewed without usable meaning, ${pending.length} pending review.`)
