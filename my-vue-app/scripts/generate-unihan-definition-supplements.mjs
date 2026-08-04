import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const unihanPath = process.argv[2] ?? '/tmp/kilo/Unihan_Readings.txt'
const makeMeAHanziPath = process.argv[3] ?? '/tmp/kilo/makemeahanzi-dictionary-2026-08-04.txt'
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const decisionsUrl = new URL('../src/data/globalNameMeaningReviewDecisions.json', import.meta.url)
const outputUrl = new URL('../src/data/unihanDefinitionSupplements.json', import.meta.url)

const dictionary = JSON.parse(await readFile(dictionaryUrl, 'utf8'))
const decisions = JSON.parse(await readFile(decisionsUrl, 'utf8'))
const unihanText = await readFile(unihanPath, 'utf8')
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

const unihan = new Map()
for (const line of unihanText.split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [codePoint, property, value] = line.split('\t')
  if (property !== 'kDefinition') continue
  unihan.set(String.fromCodePoint(Number.parseInt(codePoint.slice(2), 16)), value)
}

function hasUsableNamingDefinition(definition) {
  if (!definition || /(?:会意|形声|象形|指事|小篆字形)/u.test(definition)) return false
  const unusable = /(?:转注|假借|甲骨文|金文|小篆|部首|俗字|异体|本义|从\p{Unified_Ideograph}|见“|亦作|义同|《说文》|之形|(?:上面|下面).{0,12}(?:人|小儿|字)|移.{0,12}下|表示与.{0,12}有关|容量单位|计量单位|十斗为一石|也名|--|[“”]{2})/u
  return definition.split(/[。；;！？!，,]/u)
    .map(segment => segment.replace(/^[()（）\s]+|[()（）\s]+$/gu, '').trim())
    .some(segment => segment.length > 1 && !/[”」』〉]$/u.test(segment) && !unusable.test(segment))
}

const blockedEnglish = /(?:surname|family name|place name|transliteration|phonetic|radical|Kangxi|kwukyel|Korean|Japanese|Cantonese|Cant\.|variant|old form|ancient form|archaic|county|district|prefecture|tribe|nationality|Buddhist|Sanskrit|used in|name of|a name|proper name|ghost|fart|break wind|backing|someone powerful|behead|throat|buttock|shoes|clog|punishment|date tree|family name|spasm|convulsion|indigestion|corpse|flaw|fault|defect|ridicule|sneer|legal tender)/iu
const phraseMap = [
  [/\b(?:great|grand|large|big|vast|immense|huge|gigantic)\b/iu, '宏大'],
  [/\b(?:glorious|brilliant|splendid|bright|radiant|shine|luster|lustre)\b/iu, '光明'],
  [/\b(?:distinguished|excellent|eminent|superior|outstanding|fine)\b/iu, '卓越'],
  [/\b(?:beautiful|handsome|pretty|lovely|graceful|elegant|fair)\b/iu, '美好'],
  [/\b(?:good-looking|good looking)\b/iu, '俊美'],
  [/\b(?:strong|powerful|robust|vigorous|valiant|brave|sturdy)\b/iu, '强健'],
  [/\b(?:firm|solid|stable|steadfast|resolute|determined)\b/iu, '坚定'],
  [/\b(?:quick|fast|swift|rapid|hasty|sudden|abrupt)\b/iu, '迅速'],
  [/\b(?:nimble|clever)\b/iu, '灵巧'],
  [/\b(?:busy|diligent|untiring|industrious)\b/iu, '勤勉'],
  [/\b(?:work|labor|labour|toil)\b/iu, '劳作'],
  [/\b(?:progress|advance|develop|improve)\b/iu, '进展'],
  [/\b(?:finish|complete|entire|whole|all|overall|altogether|round)\b/iu, '完整'],
  [/\b(?:exert|strive|endeavor|endeavour)\b|\bmake effort\b/iu, '努力'],
  [/\b(?:aid|help|assist|support|rescue|save)\b/iu, '帮助'],
  [/\b(?:govern|control|manage|rule|administer|handle)\b/iu, '治理'],
  [/\b(?:nurture|raise|cultivate|foster)\b/iu, '养育'],
  [/\b(?:chivalrous|knight|knight-errant)\b/iu, '侠义'],
  [/\b(?:cautious|wary|careful)\b/iu, '谨慎'],
  [/\b(?:sincere|earnest|candid|cordial)\b/iu, '诚挚'],
  [/\b(?:give|grant|award|bestow|offer|present)\b/iu, '给予'],
  [/\b(?:produce|send out|go out)\b/iu, '发出'],
  [/\b(?:replace|substitute|change|exchange)\b/iu, '替代'],
  [/\b(?:beginning|initial|primary|first)\b/iu, '初始'],
  [/\b(?:era|generation|period)\b/iu, '世代'],
  [/\b(?:estimate|guess|presume|evaluate)\b/iu, '估量'],
  [/\b(?:hesitate|doubtful|doubt)\b/iu, '犹豫'],
  [/\b(?:far|distant)\b/iu, '遥远'],
  [/\b(?:wait|expect)\b|\blook towards?\b/iu, '等待'],
  [/\b(?:reside|live|dwell|lodge|stay|stop)\b/iu, '居住'],
  [/\b(?:serve|attend|attendant|servant)\b/iu, '侍奉'],
  [/\b(?:brother|elder brother)\b/iu, '兄长'],
  [/\b(?:companion|associate|partner|friend)\b/iu, '伴侣'],
  [/\b(?:prisoner|captive|capture)\b/iu, '俘获'],
  [/\b(?:catch|seize|arrest)\b/iu, '捉拿'],
  [/\b(?:rebel|rebellion|rebellious|betray)\b/iu, '背叛'],
  [/\b(?:scold|shout|yell|call out|cry|wail|weep|howl)\b/iu, '呼喊'],
  [/\b(?:call)\b/iu, '呼唤'],
  [/\b(?:whisper|chat|gossip|talk|mutter|mumble|babble|chatter|grunt|grumble|hum|intone|sigh|groan|roar|bellow|noise|sound)\b/iu, '声音'],
  [/\b(?:sell|sale)\b/iu, '售卖'],
  [/\b(?:cut|delete|chop|divide|mince|scoop|split|tear|crack|open)\b/iu, '切削'],
  [/\b(?:bow)\b|\bface down\b|\blook down\b/iu, '俯身'],
  [/\b(?:stand)\b|\bside by side\b/iu, '站立'],
  [/\b(?:together|accompanied|assemble|gather|combine|join)\b/iu, '共同'],
  [/\b(?:collect)\b/iu, '收集'],
  [/\b(?:enjoin|advise|encourage|excite|incite|instigate)\b/iu, '劝勉'],
  [/\b(?:merit|meritorious|deed|feat|rank)\b/iu, '功绩'],
  [/\b(?:cling|cuddle|embrace|fondle)\b/iu, '依偎'],
  [/\b(?:pleasure|enjoyment|amusement)\b/iu, '愉悦'],
  [/\b(?:music|melody|harmonious|harmony)\b/iu, '和谐'],
  [/\b(?:musical note|musical instrument|instrument|flute|harp|string)\b/iu, '音律'],
  [/\bsmile\b/iu, '笑容'],
  [/\bpuppet\b/iu, '傀儡'],
  [/\b(?:abundant|plentiful|luxuriant|lush|rich|copious)\b/iu, '丰盛'],
  [/\b(?:zealous|urgent|haste|hurriedly)\b/iu, '急切'],
  [/\b(?:thick|dense)\b/iu, '浓密'],
  [/\b(?:hidden|invisible|secret|conceal|hide)\b/iu, '隐藏'],
  [/\b(?:mysterious|obscure|profound)\b/iu, '深奥'],
  [/\b(?:stretch)\b/iu, '伸展'],
  [/\b(?:cover|lid|canopy|umbrella)\b/iu, '覆盖'],
  [/\b(?:head|top)\b/iu, '顶部'],
  [/\b(?:parapet|wall|fence|barrier)\b/iu, '墙垣'],
  [/\b(?:half|incomplete|semi-)\b/iu, '半数'],
  [/\b(?:calm|quiet|still|peaceful|peace|serenity|repose|tranquil)\b/iu, '安宁'],
  [/\b(?:jade|gem|jasper|pearl)\b/iu, '玉石'],
  [/\b(?:sun|sunshine|sunrise|dawn|morning sun|rising sun)\b/iu, '日光'],
  [/\b(?:baby|child|children|infant|twins)\b/iu, '孩童'],
  [/\b(?:settle|decide)\b/iu, '裁定'],
  [/\b(?:paint|painting|picture|drawing|draw|decorate|delineate)\b/iu, '绘饰'],
  [/\b(?:sweep|cleanse|purify|clear away|broom)\b/iu, '清扫'],
  [/\b(?:well|spring|pit|bank|shore|bridge|dike|ditch|gully|pool|ravine|torrent)\b/iu, '水土'],
  [/\b(?:bowl|vessel|container|utensil|basket|bucket|pottery|gourd|pot|basin|hat box)\b/iu, '器具'],
  [/\b(?:cloth|textile|linen|cotton|silk|thread|fabric)\b/iu, '织物'],
  [/\b(?:article|product|commodity|quality|character)\b/iu, '品类'],
  [/\b(?:announce|declare|spread|display|publish)\b/iu, '布告'],
  [/\b(?:many|much|myriads|numerous)\b/iu, '众多'],
  [/\b(?:flower|flowers|plantain|banana palm|milfoil|roots of plants)\b/iu, '花草'],
  [/\b(?:fish|bird|birds|duck|hawk|eagle|animal|beast|horse|dog|tiger|rabbit|insect|grass|plant|plants|tree|wood|bamboo)\b/iu, '生物'],
  [/\b(?:mountain|hill|rocky|stony|stone|cliff|mound|lump|mass|strata|ore|peaks)\b/iu, '山石'],
  [/\b(?:water|river|stream|wave|tide|rain|snow|ice|cloud|wind|storm)\b/iu, '自然'],
  [/\b(?:chimney|smell|scent|sniff|olfactive|breathe|yawn)\b/iu, '气息'],
  [/\b(?:red|black|white|green|blue|yellow|color|colour|dark)\b/iu, '色彩'],
  [/\b(?:small|tiny|minute|little|slight)\b/iu, '细小'],
  [/\b(?:straight|upright|correct|right|proper)\b/iu, '端正'],
  [/\b(?:wrong|false|deceive|contrary|oppose)\b/iu, '违背'],
  [/\b(?:fear|frighten|scary|afraid)\b/iu, '惊惧'],
  [/\b(?:joy|gladness|delight|happy|happiness|lucky|fortunate)\b/iu, '喜悦'],
  [/\b(?:dance|frolic|skip)\b/iu, '舞蹈'],
  [/\b(?:charming|enchanting|romantic)\b/iu, '妩媚'],
  [/\b(?:favor|favorite|favourite)\b/iu, '宠爱'],
  [/\b(?:sharp|keen-edged)\b/iu, '锐利'],
  [/\b(?:silent|be silent)\b/iu, '沉默'],
  [/\blibrary\b/iu, '藏书'],
  [/\b(?:school|tutorage)\b/iu, '学塾'],
  [/\b(?:courtyard|porch)\b/iu, '庭院'],
  [/\b(?:obedience|compliance)\b/iu, '顺从'],
]

function mappedFragments(definition) {
  return [...new Set(definition
    .split(/[;,]/u)
    .map(fragment => fragment.trim())
    .filter(fragment => fragment && !blockedEnglish.test(fragment))
    .flatMap(fragment => phraseMap
      .filter(([pattern]) => pattern.test(fragment))
      .map(([, value]) => value)))]
    .slice(0, 3)
}

const entries = Object.fromEntries(Object.entries(existingSupplements.entries ?? {}).filter(([, supplement]) => {
  if (supplement?.reviewMethod !== 'script_mapped_unihan_definition') return true
  const definitionCn = mappedFragments(supplement.sourceDefinition).join('；')
  return definitionCn === supplement.definitionCn && hasUsableNamingDefinition(definitionCn)
}))
let skippedNoSource = 0
let skippedBlocked = 0
let skippedUnmapped = 0
let skippedExisting = 0

for (const char of Object.keys(dictionary)) {
  if (entries[char]) {
    skippedExisting += 1
    continue
  }
  const unihanDefinition = unihan.get(char)
  if (!unihanDefinition) {
    skippedNoSource += 1
    continue
  }
  const fragments = mappedFragments(unihanDefinition)
  const definitionCn = fragments.join('；')
  if (!hasUsableNamingDefinition(definitionCn)) {
    skippedUnmapped += 1
    continue
  }
  if (!decisions.entries[char] && dictionary[char]?.definition_cn !== definitionCn) continue
  if (hasUsableNamingDefinition(dictionary[char]?.definition_cn) && dictionary[char]?.definition_cn !== definitionCn) {
    skippedExisting += 1
    continue
  }
  entries[char] = {
    sourceDefinition: unihanDefinition,
    makeMeAHanziDefinition: makeMeAHanzi.get(char) ?? '',
    definitionCn,
    reviewed: true,
    reviewMethod: 'script_mapped_unihan_definition',
  }
}

for (const char of Object.keys(decisions.entries)) {
  if (entries[char]) continue
  const unihanDefinition = unihan.get(char)
  if (!unihanDefinition) continue
  const fragments = mappedFragments(unihanDefinition)
  const definitionCn = fragments.join('；')
  if (!hasUsableNamingDefinition(definitionCn)) continue
  entries[char] = {
    sourceDefinition: unihanDefinition,
    makeMeAHanziDefinition: makeMeAHanzi.get(char) ?? '',
    definitionCn,
    reviewed: true,
    reviewMethod: 'script_mapped_unihan_definition',
  }
}

const output = {
  source: {
    name: 'Unicode Unihan',
    version: '17.0.0',
    file: unihanPath,
    field: 'kDefinition',
    sha256: createHash('sha256').update(unihanText).digest('hex'),
    license: 'Unicode License V3',
    licenseUrl: 'https://www.unicode.org/license.txt',
    transformation: 'Conservative Chinese keyword mapping from English kDefinition fragments; surnames, proper names, transliterations, variants, radicals, and locale-specific labels are excluded.',
  },
  corroborationSource: {
    name: 'Make Me a Hanzi dictionary.txt',
    downloadUrl: 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt',
    sha256: createHash('sha256').update(makeMeAHanziText).digest('hex'),
    license: 'LGPL-3.0-or-later',
    licenseUrl: 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/COPYING',
  },
  skippedNoSource,
  skippedBlocked,
  skippedUnmapped,
  skippedExisting,
  entries,
}

await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Generated ${Object.keys(entries).length} Unihan supplements; skipped ${skippedNoSource} without source, ${skippedBlocked} blocked, ${skippedUnmapped} unmapped, ${skippedExisting} already usable.`)
