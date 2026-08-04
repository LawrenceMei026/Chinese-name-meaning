import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFile, writeFile } from 'node:fs/promises'

const checkOnly = process.argv.includes('--check')
const outputUrl = new URL('../public/data/guangyun.json', import.meta.url)
const dictionaryUrl = new URL('../public/data/chars.json', import.meta.url)
const GUANGYUN_COMMIT = '21585e22c8a730ca2fd175112f4d18e16d5ce578'
const GUANGYUN_URL = `https://raw.githubusercontent.com/nk2028/tshet-uinh-data/${GUANGYUN_COMMIT}/%E9%9F%BB%E6%9B%B8/%E5%BB%A3%E9%9F%BB.csv`
const GUANGYUN_SHA256 = 'f2b66197355d4fbff0776ab34e4aece817363b00446fbcf08e2f1677a7ac0c5f'
const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'
const CEDICT_SHA256 = 'c3fe7b0fc6066597c81654fdbef3a23a9c33b8dd405bbbed182e9a9f8c3d5abf'

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some(value => value)) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function primaryHeadword(raw) {
  return [...raw][0] ?? ''
}

function parseCedictMappings(text) {
  const simplifiedByTraditional = new Map()
  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(\S+) (\S+) \[/u)
    if (!match || [...match[1]].length !== 1 || [...match[2]].length !== 1) continue
    const aliases = simplifiedByTraditional.get(match[1]) ?? new Set()
    aliases.add(match[2])
    simplifiedByTraditional.set(match[1], aliases)
  }
  return simplifiedByTraditional
}

function validateGenerated(data) {
  if (data.source.commit !== GUANGYUN_COMMIT || data.source.sha256 !== GUANGYUN_SHA256) {
    throw new Error('Generated Guangyun data does not match the pinned source.')
  }
  if (data.source.license !== 'CC0-1.0' || data.mappingSource.sha256 !== CEDICT_SHA256) {
    throw new Error('Generated Guangyun source or mapping metadata is invalid.')
  }
  if (data.sourceRows !== 25_336 || Object.keys(data.entries).length < 7_000) {
    throw new Error('Generated Guangyun coverage is unexpectedly incomplete.')
  }
  for (const [char, entries] of Object.entries(data.entries)) {
    if ([...char].length !== 1 || !Array.isArray(entries) || entries.length === 0) {
      throw new Error(`${char}: invalid Guangyun lookup entry`)
    }
    for (const entry of entries) {
      if (!entry.id || !entry.headword || !entry.rhyme || !entry.phonologicalPosition) {
        throw new Error(`${char}: incomplete Guangyun record`)
      }
    }
  }
}

if (checkOnly) {
  const generated = JSON.parse(await readFile(outputUrl, 'utf8'))
  validateGenerated(generated)
  console.log(`Verified ${generated.sourceRows} Guangyun rows across ${Object.keys(generated.entries).length} lookup characters.`)
} else {
  const [guangyunResponse, cedictResponse] = await Promise.all([fetch(GUANGYUN_URL), fetch(CEDICT_URL)])
  if (!guangyunResponse.ok || !cedictResponse.ok) throw new Error('Failed to download a pinned dictionary source.')
  const guangyunBytes = Buffer.from(await guangyunResponse.arrayBuffer())
  const cedictBytes = Buffer.from(await cedictResponse.arrayBuffer())
  if (sha256(guangyunBytes) !== GUANGYUN_SHA256) throw new Error('Guangyun source checksum mismatch.')
  if (sha256(cedictBytes) !== CEDICT_SHA256) throw new Error('CC-CEDICT mapping source checksum mismatch.')

  const dictionary = JSON.parse(await readFile(dictionaryUrl, 'utf8'))
  const supportedCharacters = new Set(Object.keys(dictionary))
  const simplifiedByTraditional = parseCedictMappings(gunzipSync(cedictBytes).toString('utf8'))
  const rows = parseCsv(guangyunBytes.toString('utf8'))
  const header = rows.shift()
  const expectedHeader = ['小韻號', '小韻字號', '韻目原貌', '音韻地位', '反切', '直音', '字頭', '字頭說明', '釋義', '釋義參照']
  if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) throw new Error('Unexpected Guangyun CSV schema.')

  const entries = {}
  for (const row of rows) {
    if (row.length !== expectedHeader.length) throw new Error(`Malformed Guangyun row: ${row.join(',')}`)
    const [rimeGroup, groupIndex, rhyme, phonologicalPosition, fanqie, directReading, rawHeadword, headwordNote, gloss, glossReference] = row
    const headword = primaryHeadword(rawHeadword)
    const lookupCharacters = new Set([headword, ...(simplifiedByTraditional.get(headword) ?? [])])
    const record = {
      id: `${rimeGroup}-${groupIndex}`,
      headword,
      rawHeadword,
      rhyme,
      phonologicalPosition,
      fanqie,
      directReading,
      headwordNote,
      gloss,
      glossReference,
    }
    for (const char of lookupCharacters) {
      if (!supportedCharacters.has(char)) continue
      ;(entries[char] ??= []).push(record)
    }
  }

  const generated = {
    source: {
      name: 'tshet-uinh-data 廣韻.csv',
      edition: '澤存堂本（參校《廣韻校本》《廣韻形聲考》等）',
      commit: GUANGYUN_COMMIT,
      url: GUANGYUN_URL,
      sha256: GUANGYUN_SHA256,
      license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
    mappingSource: {
      name: 'CC-CEDICT traditional/simplified headword mapping',
      release: '2026-08-02 07:59:46 GMT',
      url: CEDICT_URL,
      sha256: CEDICT_SHA256,
      license: 'CC BY-SA 4.0',
    },
    sourceRows: rows.length,
    entries,
  }
  validateGenerated(generated)
  await writeFile(outputUrl, `${JSON.stringify(generated)}\n`)
  console.log(`Generated ${rows.length} Guangyun rows across ${Object.keys(entries).length} lookup characters.`)
}
