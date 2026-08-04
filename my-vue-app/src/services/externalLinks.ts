import { openUrl } from '@tauri-apps/plugin-opener'

export const REPOSITORY_URL = 'https://github.com/LawrenceMei026/Chinese-name-meaning'
export const CC_CEDICT_URL = 'https://cc-cedict.org'
export const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'

export async function openExternalUrl(url: string, desktop: boolean): Promise<void> {
  if (desktop) {
    await openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
