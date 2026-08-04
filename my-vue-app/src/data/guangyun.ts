export type GuangyunEntry = {
  id: string
  headword: string
  rawHeadword: string
  rhyme: string
  phonologicalPosition: string
  fanqie: string
  directReading: string
  headwordNote: string
  gloss: string
  glossReference: string
}

let entries: Record<string, GuangyunEntry[]> | null = null

function dataUrl() {
  const locationHref = typeof window !== 'undefined' ? window.location.href : 'http://localhost/'
  const base = new URL(import.meta.env.BASE_URL, locationHref)
  return new URL('data/guangyun.json', base).toString()
}

export async function loadGuangyunData(): Promise<void> {
  if (entries) return
  const response = await fetch(dataUrl())
  if (!response.ok) throw new Error('Guangyun data failed to load')
  const data = await response.json() as { entries: Record<string, GuangyunEntry[]> }
  entries = data.entries
}

export function getGuangyunEntries(char: string): GuangyunEntry[] {
  return entries?.[char] ?? []
}
