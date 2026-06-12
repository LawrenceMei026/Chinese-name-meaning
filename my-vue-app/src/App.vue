<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { analyzeName, preloadDictionary } from './services/nameAnalyzer'
import { runLocalAiAnalysis } from './services/localInference'
import CharacterCard from './components/CharacterCard.vue'
import type { AnalyzedName, AiAnalysisResult } from './types'

const input = ref('')
const result = ref<AnalyzedName | null>(null)
const aiResult = ref<AiAnalysisResult | null>(null)
const loading = ref(false)
const aiLoading = ref(false)
const error = ref<string | null>(null)
const aiError = ref<string | null>(null)

function isChineseInput(name: string) {
  return /[一-鿿]/.test(name)
}

function isPinyinInput(name: string) {
  return /^[a-zA-Z\süÜvV'’-]+\d?(?:\s+[a-zA-Z\süÜvV'’-]+\d?)*$/.test(name)
}

async function handleSubmit() {
  const name = input.value.trim()
  if (!name) return

  if (!isChineseInput(name) && !isPinyinInput(name)) {
    error.value = '请输入汉字姓名或拼音。'
    return
  }

  loading.value = true
  error.value = null
  aiError.value = null
  result.value = null
  aiResult.value = null

  try {
    result.value = await analyzeName(name)
  } catch (e) {
    error.value = '字符数据加载失败，请检查网络连接后重试。'
  } finally {
    loading.value = false
  }
}

async function handleAiAnalysis() {
  if (!result.value) return

  aiLoading.value = true
  aiError.value = null

  try {
    aiResult.value = await runLocalAiAnalysis(result.value)
  } catch (e) {
    aiError.value = 'AI 深度分析暂时不可用，请稍后重试。'
  } finally {
    aiLoading.value = false
  }
}

function reset() {
  input.value = ''
  result.value = null
  aiResult.value = null
  error.value = null
  aiError.value = null
}

onMounted(() => { preloadDictionary().catch(() => {}) })
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1 class="title">汉字姓名解析</h1>
      <p class="subtitle">输入一个中文姓名，探索每个汉字背后的含义、文化内涵与历史渊源。</p>
    </header>

    <main class="main">
      <form class="search-form" @submit.prevent="handleSubmit">
        <div class="input-row">
          <input
            v-model="input"
            class="name-input"
            type="text"
            placeholder="例如：李明华"
            lang="zh"
            autocomplete="off"
            :disabled="loading || aiLoading"
            aria-label="请输入中文姓名或拼音"
          />
          <button class="analyze-btn" type="submit" :disabled="loading || aiLoading || !input.trim()">
            <span v-if="loading">解析中…</span>
            <span v-else>解析</span>
          </button>
        </div>
        <p v-if="error" class="error-msg" role="alert">{{ error }}</p>
      </form>

      <div v-if="loading" class="loading" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        加载汉字数据中…
      </div>

      <section v-if="result" class="results" aria-label="姓名解析结果">
        <div class="result-header">
          <h2 class="result-name">{{ result.original }}</h2>
          <div class="result-actions">
            <button class="ai-btn" type="button" @click="handleAiAnalysis" :disabled="aiLoading">
              <span v-if="aiLoading">AI 分析中…</span>
              <span v-else>AI 深度分析</span>
            </button>
            <button class="reset-btn" type="button" @click="reset" aria-label="清除并重新开始">✕ 清除</button>
          </div>
        </div>
        <div class="cards">
          <CharacterCard
            v-for="(char, i) in result.chars"
            :key="i"
            :data="char"
          />
        </div>

        <div v-if="aiError" class="ai-error" role="alert">{{ aiError }}</div>

        <section v-if="aiResult" class="ai-panel" aria-label="AI 深度分析结果">
          <div class="ai-panel-header">
            <h3 class="ai-title">AI 深度分析</h3>
            <span v-if="!aiResult.loadedFromCache" class="ai-badge">本地回退</span>
          </div>
          <div class="ai-labels">
            <span v-for="label in aiResult.labels" :key="label" class="ai-label">{{ label }}</span>
          </div>
          <p class="ai-summary">{{ aiResult.summary }}</p>
        </section>
      </section>
    </main>

    <footer class="app-footer">
      字典数据来自 <a href="https://cc-cedict.org" target="_blank" rel="noopener noreferrer">CC-CEDICT</a>,
      证书来自 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>.
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

.name-input {
  flex: 1;
  font-size: 1.5rem;
  padding: 0.6rem 1rem;
  border: 2px solid #ddd;
  border-radius: 10px;
  background: #fff;
  color: #1a1a1a;
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  transition: border-color 0.2s;
  outline: none;
}

.name-input:focus {
  border-color: #8b2c2c;
}

.name-input:disabled {
  opacity: 0.6;
}

.analyze-btn,
.ai-btn {
  padding: 0.6rem 1.5rem;
  background: #8b2c2c;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.ai-btn {
  background: #2c5f8b;
}

.analyze-btn:hover:not(:disabled) {
  background: #6e2222;
}

.ai-btn:hover:not(:disabled) {
  background: #234d70;
}

.analyze-btn:disabled,
.ai-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-msg,
.ai-error {
  color: #c0392b;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

.loading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #888;
  font-size: 0.95rem;
  padding: 1rem 0;
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

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
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

.reset-btn:hover {
  border-color: #aaa;
  color: #555;
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

.app-footer {
  margin-top: 3rem;
  text-align: center;
  font-size: 0.8rem;
  color: #aaa;
}

.app-footer a {
  color: #8b6a4a;
  text-decoration: none;
}

.app-footer a:hover {
  text-decoration: underline;
}
</style>
