import { expect, test } from '@playwright/test'

test('supports the full analysis, history, and fallback flow', async ({ page }) => {
  await page.route('**/models/manifest.json', route => route.fulfill({ status: 404, body: '' }))

  await page.goto('/')

  await expect(page.getByRole('heading', { name: '汉字姓名解析' })).toBeVisible()
  await expect(page.getByText('等待解析')).toBeVisible()

  const input = page.getByLabel('请输入中文姓名或拼音')
  await input.fill('李明华')
  await page.getByRole('button', { name: '解析' }).click()

  const results = page.getByRole('region', { name: '姓名解析结果' })
  await expect(results).toBeVisible()
  await expect(results.getByRole('heading', { name: '李明华' })).toBeVisible()
  await expect(results.getByText('共 3 个字')).toBeVisible()
  await expect(page.locator('.cards .char-card')).toHaveCount(3)

  const historyStorage = await page.evaluate(() => window.localStorage.getItem('analysis-history-v1'))
  expect(historyStorage).toContain('李明华')

  await page.reload()
  const history = page.getByRole('region', { name: '历史记录' })
  await expect(history).toBeVisible()
  await expect(history.getByRole('button', { name: /李明华/ })).toBeVisible()

  await history.getByRole('button', { name: /李明华/ }).click()
  await expect(page.getByLabel('请输入中文姓名或拼音')).toHaveValue('李明华')
  await expect(page.getByRole('heading', { name: '李明华' })).toBeVisible()
  await expect(page.getByText('共 3 个字')).toBeVisible()

  await page.getByRole('button', { name: 'AI 深度分析' }).click()
  await expect(page.getByRole('status')).toHaveText('正在调用本地模型生成补充分析…')
  await expect(page.getByRole('heading', { name: 'AI 深度分析' })).toBeVisible()
  await expect(page.getByText('本地回退')).toBeVisible()
  await expect(page.locator('.ai-label')).toHaveCount(1)
  await expect(page.locator('.ai-summary')).toContainText('本地规则回退结果')

  await page.getByRole('button', { name: '清空历史' }).click()
  await expect(history).toHaveCount(0)
})
