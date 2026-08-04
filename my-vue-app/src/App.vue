<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { analyzeName, preloadDictionary } from './services/nameAnalyzer'
import { runLocalAiAnalysis, checkNativeModel, startModelDownload, checkSystemMemory, formatModelDownloadError, getModelDirectory, setModelDirectory } from './services/localInference'
import { CC_BY_SA_URL, CC_CEDICT_URL, openExternalUrl, REPOSITORY_URL } from './services/externalLinks'
import CharacterCard from './components/CharacterCard.vue'
import type { AnalysisHistoryEntry, AnalyzedName, AiAnalysisResult } from './types'
import type { GuangyunEntry } from './data/guangyun'

const HISTORY_KEY = 'analysis-history-v1'
const HISTORY_LIMIT = 6

const input = ref('')
const result = ref<AnalyzedName | null>(null)
const aiResult = ref<AiAnalysisResult | null>(null)
const loading = ref(false)
const aiLoading = ref(false)
const error = ref<string | null>(null)
const aiError = ref<string | null>(null)
const showGuangyun = ref(false)
const guangyunError = ref<string | null>(null)
const guangyunLoaded = ref(false)
const guangyunLoading = ref(false)
const guangyunLookup = shallowRef<(char: string) => GuangyunEntry[]>(() => [])
const history = ref<AnalysisHistoryEntry[]>([])
const activeHistoryEntryId = ref<string | null>(null)

// Native Model 状态
const modelReady = ref(true)
const downloadWindowOpen = ref(false)
const downloadProgress = ref(0)
const downloadMeta = ref({ downloaded: '0MB', total: '0MB' })
const isDownloading = ref(false)
const lowMemoryWarning = ref(false)
const modelDirectory = ref('')
let aiController: AbortController | null = null

watch(showGuangyun, async enabled => {
  if (!enabled || guangyunLoading.value || guangyunLoaded.value) return
  guangyunLoading.value = true
  guangyunError.value = null
  try {
    const { getGuangyunEntries, loadGuangyunData } = await import('./data/guangyun')
    await loadGuangyunData()
    guangyunLookup.value = getGuangyunEntries
    guangyunLoaded.value = true
  } catch {
    guangyunError.value = '《广韵》数据载入失败，请重新勾选后重试。'
  } finally {
    guangyunLoading.value = false
  }
})

const inputId = 'name-input'
const helpId = 'name-input-help'
const errorId = 'name-input-error'
const isBusy = computed(() => loading.value || aiLoading.value)
const isTauri = '__TAURI_INTERNALS__' in window

function isHistoryEntry(value: unknown): value is AnalysisHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as AnalysisHistoryEntry
  return typeof entry.id === 'string'
    && typeof entry.input === 'string'
    && typeof entry.createdAt === 'number'
    && typeof entry.result === 'object'
    && entry.result !== null
    && typeof entry.result.original === 'string'
    && Array.isArray(entry.result.chars)
}

function readHistory(): AnalysisHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function saveHistory(entries: AnalysisHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
  } catch {
    // Ignore storage failures so analysis still works.
  }
}

function formatHistoryTime(createdAt: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}

function persistHistoryEntry(entry: AnalysisHistoryEntry) {
  history.value = [entry, ...history.value].slice(0, HISTORY_LIMIT)
  saveHistory(history.value)
}

function restoreHistoryEntry(entry: AnalysisHistoryEntry) {
  aiController?.abort()
  input.value = entry.input
  result.value = entry.result
  aiResult.value = entry.aiResult ?? null
  error.value = null
  aiError.value = null
  activeHistoryEntryId.value = entry.id
}

function updateActiveHistoryEntry(aiAnalysis: AiAnalysisResult) {
  if (!activeHistoryEntryId.value) return
  const index = history.value.findIndex(entry => entry.id === activeHistoryEntryId.value)
  if (index === -1) return
  history.value[index] = {
    ...history.value[index]!,
    aiResult: aiAnalysis,
  }
  saveHistory(history.value)
}

function clearHistory() {
  history.value = []
  saveHistory(history.value)
}

async function handleSubmit() {
  aiController?.abort()
  const name = input.value.trim()
  if (!name) return

  if (!/^[一-龥]+$/.test(name)) {
    error.value = '请输入纯汉字姓名。'
    return
  }

  if (name.length < 2 || name.length > 4) {
    error.value = '姓名长度应为 2-4 个汉字。'
    return
  }

  loading.value = true
  error.value = null
  aiError.value = null
  result.value = null
  aiResult.value = null
  activeHistoryEntryId.value = null

  try {
    const analyzed = await analyzeName(name)
    result.value = analyzed
    const now = Date.now()
    persistHistoryEntry({
      id: `${now}-${history.value.length}`,
      input: name,
      createdAt: now,
      result: analyzed,
    })
  } catch {
    error.value = '字符数据加载失败，请检查网络连接后重试。'
  } finally {
    loading.value = false
  }
}

async function handleAiAnalysis() {
  if (!result.value) return

  if (aiLoading.value) {
    aiController?.abort()
    return
  }

  aiController?.abort()
  const controller = new AbortController()
  aiController = controller
  aiLoading.value = true
  aiError.value = null

  try {
    aiResult.value = await runLocalAiAnalysis(result.value, { signal: controller.signal })
    updateActiveHistoryEntry(aiResult.value)
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    const expectedMessage = caught instanceof Error
      && /^(?:原生 Qwen 输出未通过事实检查，请重新分析。|原生 Qwen 生成超时，请重试。|原生 Qwen 运行失败，请重试。)$/u.test(caught.message)
      ? caught.message
      : null
    aiError.value = expectedMessage ?? 'AI 深度分析暂时不可用，请稍后重试。'
  } finally {
    if (aiController === controller) {
      aiController = null
      aiLoading.value = false
    }
  }
}

function reset() {
  aiController?.abort()
  input.value = ''
  result.value = null
  aiResult.value = null
  error.value = null
  aiError.value = null
  activeHistoryEntryId.value = null
}

async function handleFeedback() {
  const repoUrl = `${REPOSITORY_URL}/issues/new`
  const title = encodeURIComponent('用户反馈：[在此输入简短描述]')

  // 收集简单的环境信息，方便排查 AI 推理问题
  const envInfo = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || 'Unknown',
    isTauri,
  }

  const body = encodeURIComponent(
    `## 反馈内容\n[请描述您遇到的问题或建议]\n\n` +
    `## 环境信息\n` +
    `- 应用版本: ${__APP_VERSION__}\n` +
    `- 运行平台: ${envInfo.isTauri ? 'Tauri Desktop' : 'Web Browser'}\n` +
    `- 操作系统: ${envInfo.platform}\n` +
    `- 用户代理: ${envInfo.userAgent}\n`
  )

  try {
    await openExternalUrl(`${repoUrl}?title=${title}&body=${body}&labels=feedback`, isTauri)
  } catch {
    alert('无法打开系统浏览器，请稍后重试。')
  }
}

async function handleRepository() {
  try {
    await openExternalUrl(REPOSITORY_URL, isTauri)
  } catch {
    alert('无法打开系统浏览器，请稍后重试。')
  }
}

async function handleCredit(url: string) {
  try {
    await openExternalUrl(url, isTauri)
  } catch {
    alert('无法打开系统浏览器，请稍后重试。')
  }
}

async function handleActionDownload() {
  const directory = modelDirectory.value.trim()
  if (!directory) {
    alert('请选择模型下载目录。')
    return
  }
  isDownloading.value = true
  try {
    modelDirectory.value = await setModelDirectory(directory)
    await startModelDownload((p) => {
      downloadProgress.value = Math.round(p.progress)
      downloadMeta.value = {
        downloaded: (p.downloaded / 1024 / 1024).toFixed(1) + 'MiB',
        total: (p.total_size / 1024 / 1024).toFixed(1) + 'MiB'
      }
    })
    modelReady.value = true
    downloadWindowOpen.value = false
  } catch (downloadError) {
    alert(formatModelDownloadError(downloadError))
  } finally {
    isDownloading.value = false
  }
}

onMounted(async () => {
  history.value = readHistory()
  preloadDictionary().catch(() => {})

  // Tauri 环境下的模型与内存检查
  if (isTauri) {
    try {
      modelDirectory.value = await getModelDirectory()
    } catch {
      modelDirectory.value = ''
    }
    try {
      lowMemoryWarning.value = await checkSystemMemory() < 6
    } catch {
      lowMemoryWarning.value = false
    }
    let hasModel = false
    try {
      hasModel = await checkNativeModel()
    } catch {
      hasModel = false
    }
    if (!hasModel) {
      modelReady.value = false
      downloadWindowOpen.value = true
    }
  }
})

onUnmounted(() => {
  aiController?.abort()
  aiController = null
})
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1 class="title">汉字姓名解析</h1>
      <p class="subtitle">输入一个中文姓名，探索每个汉字背后的含义、文化内涵与历史渊源。</p>
      <button v-if="isTauri" class="model-settings-btn" type="button" @click="downloadWindowOpen = true">
        模型设置
      </button>
    </header>

    <!-- 模型下载引导层 -->
    <div v-if="downloadWindowOpen" class="model-overlay">
      <div class="model-modal">
        <h2 class="modal-title">初始化智能引擎</h2>
        <p class="modal-desc">为了提供更精准的姓名意境分析，我们需要下载一个本地 AI 模型（约 491MB）。</p>

        <label class="model-path-label" for="model-directory">模型下载目录</label>
        <input
          id="model-directory"
          v-model="modelDirectory"
          class="model-path-input"
          type="text"
          :disabled="isDownloading"
          autocomplete="off"
          spellcheck="false"
          placeholder="例如：D:\Chinese Name Meaning Explorer\models"
        />
        <p class="model-path-help">将自动保存选择，并在目录中使用固定且经过校验的模型文件名。</p>

        <div v-if="isDownloading" class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
          </div>
          <div class="progress-text">
            <span>正在载入资源... {{ downloadProgress }}%</span>
            <span>{{ downloadMeta.downloaded }} / {{ downloadMeta.total }}</span>
          </div>
        </div>

        <div v-if="lowMemoryWarning" class="mem-warning">
          ⚠️ 检测到系统内存不足 6GB，AI 分析可能会比较缓慢或导致应用卡顿。
        </div>

        <div class="modal-actions">
          <button
            class="download-btn"
            :disabled="isDownloading"
            @click="handleActionDownload"
          >
            {{ isDownloading ? '正在下载...' : '立即下载并启动' }}
          </button>
          <button
            v-if="!isDownloading"
            class="skip-btn"
            @click="downloadWindowOpen = false"
          >
            稍后提醒（使用基础模式）
          </button>
        </div>
      </div>
    </div>

    <main class="main" :aria-busy="isBusy">
      <form class="search-form" @submit.prevent="handleSubmit">
        <label class="sr-only" :for="inputId">请输入中文姓名</label>
        <div class="input-row">
          <input
            v-model="input"
            :id="inputId"
            class="name-input"
            type="text"
            placeholder="例如：李明华"
            lang="zh"
            autocomplete="off"
            inputmode="text"
            spellcheck="false"
            :disabled="loading || aiLoading"
            :aria-invalid="!!error"
            :aria-describedby="`${helpId} ${error ? errorId : ''}`.trim()"
          />
          <button class="analyze-btn" type="submit" :disabled="loading || aiLoading || !input.trim()">
            <span v-if="loading">解析中…</span>
            <span v-else>解析</span>
          </button>
        </div>
        <div class="search-options">
          <p :id="helpId" class="field-help">支持 2-4 个汉字姓名。</p>
          <label class="guangyun-toggle" for="show-guangyun">
            <input id="show-guangyun" v-model="showGuangyun" type="checkbox" />
            显示《广韵》切音和古义
            <span v-if="guangyunLoading" class="guangyun-loading">载入中…</span>
          </label>
        </div>
        <p v-if="guangyunError" class="guangyun-error" role="alert">{{ guangyunError }}</p>
        <p v-if="error" :id="errorId" class="error-msg" role="alert">{{ error }}</p>
      </form>

      <div v-if="loading" class="loading" role="status" aria-live="polite" aria-atomic="true">
        <span class="spinner" aria-hidden="true"></span>
        加载汉字数据中…
      </div>

      <section v-else-if="!result" class="empty-state" aria-labelledby="empty-state-title">
        <h2 id="empty-state-title" class="empty-title">等待解析</h2>
        <p class="empty-copy">输入中文姓名后，系统会先识别姓氏，再展示每个字的读音、含义和文化内涵。</p>
        <ul class="empty-tips">
          <li>支持 2-4 个汉字姓名</li>
          <li>会自动区分姓和名</li>
        </ul>
      </section>

      <section v-if="result" class="results" aria-label="姓名解析结果" :aria-busy="aiLoading">
        <div class="result-header">
          <div>
            <h2 class="result-name">{{ result.original }}</h2>
            <p class="result-meta">共 {{ result.chars.length }} 个字</p>
          </div>
          <div class="result-actions">
            <button class="ai-btn" type="button" @click="handleAiAnalysis">
              <span v-if="aiLoading">取消分析</span>
              <span v-else>AI 深度分析</span>
            </button>
            <button class="reset-btn" type="button" @click="reset" aria-label="清除并重新开始">✕ 清除</button>
          </div>
        </div>
        <div v-if="aiLoading" class="ai-status" role="status" aria-live="polite">正在调用本地模型生成补充分析…</div>
        <div class="cards">
          <CharacterCard
            v-for="(char, i) in result.chars"
            :key="i"
            :data="char"
            :guangyun-entries="guangyunLookup(char.char)"
            :show-guangyun="showGuangyun && guangyunLoaded"
          />
        </div>

        <div v-if="aiError" class="ai-error" role="alert">{{ aiError }}</div>

        <section v-if="aiResult" class="ai-panel" aria-label="AI 深度分析结果">
          <div class="ai-panel-header">
            <h3 class="ai-title">AI 深度分析</h3>
            <span class="ai-badge">{{ aiResult.summarySource === 'native' ? '原生 Qwen' : aiResult.summarySource === 'ollama' ? 'Ollama' : '本地回退' }}</span>
          </div>
          <div class="ai-labels">
            <span v-for="label in aiResult.labels" :key="label" class="ai-label">{{ label }}</span>
          </div>
          <p class="ai-summary">{{ aiResult.summary }}</p>
        </section>
      </section>

      <section v-if="history.length" class="history" aria-labelledby="history-title">
        <div class="history-header">
          <h2 id="history-title" class="history-title">历史记录</h2>
          <button class="history-clear" type="button" @click="clearHistory">清空历史</button>
        </div>
        <ul class="history-list">
          <li v-for="entry in history" :key="entry.id" class="history-item">
            <button type="button" class="history-button" @click="restoreHistoryEntry(entry)">
              <span class="history-name">{{ entry.input }}</span>
              <span class="history-meta">{{ formatHistoryTime(entry.createdAt) }}</span>
            </button>
          </li>
        </ul>
      </section>
    </main>

    <footer class="app-footer">
      <div class="footer-links">
        <button class="feedback-link" @click="handleFeedback">提交反馈</button>
        <span class="divider">|</span>
        <button class="feedback-link" @click="handleRepository">项目源码</button>
      </div>
      <div class="footer-credits">
        字典数据来自 <button class="credit-link" type="button" @click="handleCredit(CC_CEDICT_URL)">CC-CEDICT</button>,
        证书来自 <button class="credit-link" type="button" @click="handleCredit(CC_BY_SA_URL)">CC BY-SA 4.0</button>.
      </div>
    </footer>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f0e8;
  color: #1a1a1a;
  min-height: 100vh;
}
</style>

<style scoped>
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

.app-header {
  text-align: center;
  margin-bottom: 2.5rem;
}

/* 模型下载浮层样式 */
.model-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.model-modal {
  background: #fff;
  border-radius: 20px;
  max-width: 500px;
  width: 100%;
  padding: 2.5rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  text-align: center;
  max-height: calc(100vh - 3rem);
  overflow-y: auto;
}

.modal-title {
  font-size: 1.5rem;
  color: #1a1a1a;
  margin-bottom: 1rem;
}

.modal-desc {
  color: #666;
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.model-path-label {
  display: block;
  margin-bottom: 0.5rem;
  color: #333;
  font-size: 0.9rem;
  font-weight: 600;
  text-align: left;
}

.model-path-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d8d0c8;
  border-radius: 10px;
  padding: 0.75rem;
  color: #292421;
  background: #fffdf9;
  font: inherit;
}

.model-path-input:focus {
  border-color: #8b2c2c;
  outline: 2px solid rgba(139, 44, 44, 0.15);
}

.model-path-help {
  margin: 0.5rem 0 1.5rem;
  color: #777;
  font-size: 0.8rem;
  line-height: 1.5;
  text-align: left;
}

.progress-container {
  margin-bottom: 2rem;
}

.progress-bar {
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.progress-fill {
  height: 100%;
  background: #8b2c2c;
  transition: width 0.3s ease;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #888;
}

.mem-warning {
  background: #fff8e1;
  border: 1px solid #ffe082;
  color: #795548;
  padding: 0.75rem;
  border-radius: 10px;
  font-size: 0.85rem;
  margin-bottom: 1.5rem;
  text-align: left;
}

.modal-actions {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.download-btn {
  padding: 1rem;
  background: #8b2c2c;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
}

.skip-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 0.9rem;
  cursor: pointer;
}

.skip-btn:hover {
  color: #555;
}

.model-settings-btn {
  margin-top: 0.75rem;
  border: 1px solid rgba(139, 44, 44, 0.35);
  border-radius: 999px;
  padding: 0.45rem 0.9rem;
  color: #762626;
  background: rgba(255, 255, 255, 0.65);
  cursor: pointer;
}

.title {
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #1a1a1a;
  margin-bottom: 0.5rem;
}

.subtitle {
  color: #666;
  font-size: 1rem;
  max-width: 480px;
  margin: 0 auto;
  line-height: 1.5;
}

.search-form {
  margin-bottom: 2rem;
}

.input-row {
  display: flex;
  gap: 0.75rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.name-input {
  flex: 1;
  font-size: 1.5rem;
  padding: 0.6rem 1rem;
  border: 2px solid #ddd;
  border-radius: 10px;
  background: #fff;
  color: #1a1a1a;
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.name-input:focus,
.name-input:focus-visible {
  border-color: #8b2c2c;
  box-shadow: 0 0 0 3px rgba(139, 44, 44, 0.15);
}

.name-input:disabled {
  opacity: 0.6;
}

.field-help {
  color: #7c6b57;
  font-size: 0.85rem;
  line-height: 1.5;
}

.search-options {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  justify-content: space-between;
  margin-top: 0.5rem;
}

.guangyun-toggle {
  align-items: center;
  color: #6f4e37;
  cursor: pointer;
  display: inline-flex;
  font-size: 0.85rem;
  gap: 0.4rem;
}

.guangyun-toggle input {
  accent-color: #8b2c2c;
  height: 1rem;
  width: 1rem;
}

.guangyun-loading {
  color: #8b7b69;
  font-size: 0.78rem;
}

.guangyun-error {
  color: #a22d2d;
  font-size: 0.82rem;
  margin-top: 0.45rem;
}

.analyze-btn,
.ai-btn,
.history-button,
.history-clear {
  padding: 0.6rem 1.5rem;
  background: #8b2c2c;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
  white-space: nowrap;
}

.ai-btn {
  background: #2c5f8b;
}

.analyze-btn:hover:not(:disabled),
.analyze-btn:focus-visible:not(:disabled) {
  background: #6e2222;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(139, 44, 44, 0.18);
}

.ai-btn:hover:not(:disabled),
.ai-btn:focus-visible:not(:disabled) {
  background: #234d70;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(44, 95, 139, 0.18);
}

.analyze-btn:disabled,
.ai-btn:disabled,
.history-button:disabled,
.history-clear:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-msg,
.ai-error {
  color: #c0392b;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

.loading,
.empty-state,
.ai-status,
.history {
  border: 1px solid #eadfce;
  background: rgba(255, 255, 255, 0.78);
  border-radius: 16px;
  padding: 1rem 1.1rem;
  box-shadow: 0 6px 18px rgba(106, 82, 54, 0.08);
}

.loading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #888;
  font-size: 0.95rem;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #ddd;
  border-top-color: #8b2c2c;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  color: #4c4033;
  margin-top: 0.5rem;
}

.empty-title {
  font-size: 1.05rem;
  margin-bottom: 0.5rem;
  color: #234d70;
}

.empty-copy {
  line-height: 1.7;
  margin-bottom: 0.75rem;
}

.empty-tips {
  padding-left: 1.2rem;
  color: #6f5c4a;
  line-height: 1.7;
}

.empty-tips li + li {
  margin-top: 0.2rem;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.result-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.result-name {
  font-size: 2.5rem;
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  color: #1a1a1a;
  letter-spacing: 0.1em;
}

.result-meta {
  margin-top: 0.35rem;
  color: #7c6b57;
  font-size: 0.9rem;
}

.reset-btn {
  background: none;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover,
.reset-btn:focus-visible {
  border-color: #aaa;
  color: #555;
}

.ai-status {
  color: #234d70;
  margin-bottom: 0.75rem;
}

.cards {
  display: grid;
  gap: 1rem;
}

.ai-panel {
  margin-top: 1rem;
  background: linear-gradient(135deg, #f6fbff, #eef4f8);
  border: 1px solid #dbe7f0;
  border-radius: 14px;
  padding: 1rem 1.1rem;
}

.ai-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.ai-title {
  font-size: 1rem;
  color: #234d70;
}

.ai-badge {
  font-size: 0.75rem;
  color: #2c5f8b;
  border: 1px solid #b9d0e1;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  background: #fff;
}

.ai-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.ai-label {
  background: #2c5f8b;
  color: #fff;
  border-radius: 999px;
  padding: 0.3rem 0.7rem;
  font-size: 0.85rem;
}

.ai-summary {
  color: #234d70;
  line-height: 1.7;
}

.history {
  margin-top: 1rem;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.history-title {
  font-size: 1rem;
  color: #234d70;
}

.history-clear {
  background: none;
  color: #8b6a4a;
  border: 1px solid #d7c6b2;
  padding: 0.35rem 0.75rem;
}

.history-clear:hover:not(:disabled),
.history-clear:focus-visible:not(:disabled) {
  background: rgba(139, 106, 74, 0.08);
}

.history-list {
  list-style: none;
  display: grid;
  gap: 0.5rem;
}

.history-button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  background: #fff;
  color: #1a1a1a;
  border: 1px solid #e3d8ca;
  text-align: left;
}

.history-button:hover:not(:disabled),
.history-button:focus-visible:not(:disabled) {
  background: #faf6ef;
  border-color: #cfbda8;
}

.history-name {
  font-family: 'Noto Serif SC', 'Songti SC', serif;
}

.history-meta {
  color: #7c6b57;
  font-size: 0.82rem;
  flex-shrink: 0;
}

.app-footer {
  margin-top: 3rem;
  text-align: center;
  font-size: 0.8rem;
  color: #aaa;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.footer-links {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.75rem;
}

.feedback-link {
  background: none;
  border: none;
  color: #8b6a4a;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 2px 4px;
}

.feedback-link:hover {
  text-decoration: underline;
}

.divider {
  color: #ddd;
}

.credit-link {
  background: none;
  border: none;
  color: #8b6a4a;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-decoration: none;
}

.credit-link:hover {
  text-decoration: underline;
}

.app-footer a:hover,
.app-footer a:focus-visible {
  text-decoration: underline;
}
</style>
