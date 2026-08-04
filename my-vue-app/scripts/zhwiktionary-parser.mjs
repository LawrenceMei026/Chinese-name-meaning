function stripWikiMarkup(text) {
  return text
    .replace(/<!--[^]*?-->/gu, '')
    .replace(/<ref\b[^>]*>[^]*?<\/ref>/giu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/\{\{lb\|zh\|([^}]+)\}\}/giu, '（$1）')
    .replace(/\{\{[^}]*\}\}/gu, '')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/gu, '$1')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .replace(/'''?/gu, '')
    .replace(/&nbsp;/giu, ' ')
    .trim()
}

function headingLevel(line) {
  return line.match(/^(=+)\s*[^=]+\s*\1\s*$/u)?.[1].length ?? 0
}

function headingTitle(line) {
  return line.replace(/^=+\s*|\s*=+$/gu, '').trim()
}

export function extractModernChineseDefinitions(wikitext) {
  const definitions = []
  let inChineseSection = false
  let excludedSubsection = false

  for (const rawLine of wikitext.split('\n')) {
    const line = rawLine.trim()
    const level = headingLevel(line)
    if (level === 2) {
      inChineseSection = /^(?:漢語|汉语|中文|華語|华语)$/u.test(headingTitle(line))
      excludedSubsection = false
      continue
    }
    if (!inChineseSection) continue
    if (level >= 3) {
      excludedSubsection = /(?:讀音|读音|發音|发音|字源|異體|异体|翻譯|翻译|參見|参见|詞源|词源|用法|筆順|笔顺)/u.test(headingTitle(line))
      continue
    }
    if (excludedSubsection || !line.startsWith('#')) continue
    if (/^#\s*[:*]/u.test(line)) continue

    const definition = stripWikiMarkup(line.replace(/^#+\s*/u, ''))
    if (definition) definitions.push(definition)
  }

  return definitions
}
