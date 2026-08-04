import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn<(url: string) => Promise<void>>(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openUrlMock }))

describe('external links', () => {
  beforeEach(() => {
    openUrlMock.mockReset()
  })

  it('opens the real repository in the system browser from Tauri', async () => {
    const { openExternalUrl, REPOSITORY_URL } = await import('../services/externalLinks')

    await openExternalUrl(REPOSITORY_URL, true)

    expect(REPOSITORY_URL).toBe('https://github.com/LawrenceMei026/Chinese-name-meaning')
    expect(openUrlMock).toHaveBeenCalledWith(REPOSITORY_URL)
  })

  it('opens both credit links in the system browser from Tauri', async () => {
    const { CC_BY_SA_URL, CC_CEDICT_URL, openExternalUrl } = await import('../services/externalLinks')

    expect(CC_CEDICT_URL).toBe('https://cc-cedict.org')
    expect(CC_BY_SA_URL).toBe('https://creativecommons.org/licenses/by-sa/4.0/')

    await openExternalUrl(CC_CEDICT_URL, true)
    await openExternalUrl(CC_BY_SA_URL, true)

    expect(openUrlMock.mock.calls).toEqual([
      [CC_CEDICT_URL],
      [CC_BY_SA_URL],
    ])
  })
})
