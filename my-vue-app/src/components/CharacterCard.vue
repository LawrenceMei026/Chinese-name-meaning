<script setup lang="ts">
import { computed } from 'vue'
import { formatPinyin } from '../services/nameAnalyzer'
import type { AnalyzedChar } from '../types'

const props = defineProps<{ data: AnalyzedChar }>()

const pinyin = computed(() =>
  props.data.entry ? formatPinyin(props.data.entry.pinyin) : null,
)

const toneNumber = computed(() => {
  if (!props.data.entry) return 0
  const match = props.data.entry.pinyin.match(/(\d)(?:\s|$)/)
  return match ? parseInt(match[1]!) : 0
})

const toneLabel = computed(() => {
  const labels = ['', '第一声（阴平）', '第二声（阳平）', '第三声（上声）', '第四声（去声）', '轻声']
  return labels[toneNumber.value] ?? ''
})

const genderLabel = computed(() => {
  const map = { masculine: '偏男性用字', feminine: '偏女性用字', neutral: '男女通用' }
  return props.data.cultural?.genderBias ? map[props.data.cultural.genderBias] : null
})

const elementColor = computed(() => {
  const colors: Record<string, string> = {
    '木': '#4a7c59',
    '火': '#c0392b',
    '土': '#b7950b',
    '金': '#7f8c8d',
    '水': '#1a5276',
  }
  return props.data.cultural?.element ? colors[props.data.cultural.element] : '#555'
})

const localGloss = computed(() => props.data.cultural?.localGloss ?? null)
const primaryMeaning = computed(() => {
  if (props.data.cultural?.connotation) return props.data.cultural.connotation
  return props.data.entry?.definitions[0] ?? null
})
const secondaryMeaning = computed(() => {
  if (!props.data.entry || !props.data.cultural?.connotation) return props.data.entry?.definitions.slice(0, 2) ?? []
  return props.data.entry.definitions.slice(0, 1)
})
</script>

<template>
  <div class="char-card" :class="data.role">
    <div class="char-header">
      <span class="char-glyph">{{ data.char }}</span>
      <div class="char-meta">
        <span class="role-badge">{{ data.role === 'surname' ? '姓' : '名' }}</span>
        <span v-if="pinyin" class="pinyin">{{ pinyin }}</span>
        <span v-if="toneLabel" class="tone">{{ toneLabel }}</span>
      </div>
    </div>

    <div class="meaning-block">
      <p v-if="localGloss" class="local-gloss">{{ localGloss }}</p>
      <p v-if="primaryMeaning" class="primary-meaning">{{ primaryMeaning }}</p>
      <p v-for="(def, i) in secondaryMeaning" :key="i" class="def">{{ def }}</p>
    </div>

    <div v-if="data.entry?.traditional" class="traditional">
      繁体字：<span class="trad-char">{{ data.entry.traditional }}</span>
    </div>

    <div v-if="data.cultural" class="cultural-section">
      <div v-if="data.cultural.element" class="element-badge" :style="{ background: elementColor }">
        {{ data.cultural.elementEmoji }} {{ data.cultural.element }}行
      </div>
      <p v-if="data.cultural.connotation" class="connotation">{{ data.cultural.connotation }}</p>
      <p v-if="genderLabel" class="gender-note">{{ genderLabel }}</p>
      <blockquote v-if="data.cultural.literaryRef" class="literary-ref">
        {{ data.cultural.literaryRef }}
      </blockquote>
    </div>
  </div>
</template>

<style scoped>
.char-card {
  background: #fff;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  border-left: 4px solid #ccc;
}

.char-card.surname {
  border-left-color: #8b2c2c;
}

.char-card.given {
  border-left-color: #2c5f8b;
}

.char-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.char-glyph {
  font-size: 3.5rem;
  line-height: 1;
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  color: #1a1a1a;
}

.char-meta {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-top: 0.2rem;
}

.role-badge {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
}

.pinyin {
  font-size: 1.25rem;
  color: #333;
  font-style: italic;
}

.tone {
  font-size: 0.8rem;
  color: #999;
}

.meaning-block {
  margin-bottom: 0.75rem;
}

.local-gloss {
  font-size: 1rem;
  font-weight: 600;
  color: #234d70;
  line-height: 1.6;
  margin: 0 0 0.35rem;
}

.primary-meaning {
  margin: 0.15rem 0;
  color: #333;
  font-size: 0.96rem;
  line-height: 1.6;
}

.def {
  margin: 0.25rem 0;
  color: #555;
  font-size: 0.92rem;
  line-height: 1.6;
}

.no-entry {
  color: #aaa;
  font-style: italic;
}

.traditional {
  font-size: 0.8rem;
  color: #888;
  margin-bottom: 0.75rem;
}

.trad-char {
  font-size: 1rem;
  font-family: 'Noto Serif SC', serif;
  color: #555;
}

.cultural-section {
  border-top: 1px solid #f0f0f0;
  padding-top: 0.75rem;
  margin-top: 0.75rem;
}

.element-badge {
  display: inline-block;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.25rem 0.6rem;
  border-radius: 20px;
  margin-bottom: 0.5rem;
}

.connotation {
  color: #444;
  font-size: 0.9rem;
  line-height: 1.6;
  margin: 0.4rem 0;
}

.gender-note {
  font-size: 0.8rem;
  color: #888;
  margin: 0.25rem 0;
}

.literary-ref {
  border-left: 3px solid #e8d5a3;
  margin: 0.75rem 0 0;
  padding: 0.5rem 0.75rem;
  background: #fdf8f0;
  border-radius: 0 6px 6px 0;
  font-size: 0.85rem;
  color: #6b5b2a;
  font-style: italic;
  line-height: 1.6;
}

@media (max-width: 640px) {
  .char-card {
    padding: 1.2rem;
  }

  .char-header {
    flex-direction: column;
    gap: 0.6rem;
  }

  .char-glyph {
    font-size: 3rem;
  }
}
</style>
