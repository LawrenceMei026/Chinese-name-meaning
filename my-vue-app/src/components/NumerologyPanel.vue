<script setup lang="ts">
import { computed } from 'vue'
import type { NameNumerology } from '../services/nameNumerology'
import { elementForNumber } from '../data/numerologyTables'

const props = defineProps<{ numerology: NameNumerology }>()

const gridRows = computed(() => {
  const grids = props.numerology.grids
  if (!grids) return []
  return [
    { key: 'tian', label: '天格', reading: grids.tian },
    { key: 'ren', label: '人格', reading: grids.ren },
    { key: 'di', label: '地格', reading: grids.di },
    { key: 'wai', label: '外格', reading: grids.wai },
    { key: 'zong', label: '总格', reading: grids.zong },
  ]
})

const unavailableText = computed(() => {
  const numerology = props.numerology
  if (!numerology.supported) {
    if (numerology.unsupportedReason === 'surname-unrecognized') {
      return '未识别到姓氏，暂无法推算五格数理。'
    }
    if (numerology.unsupportedReason === 'name-structure-unsupported') {
      return '该姓名的结构暂不在五格三才推算范围（支持姓 1-2 字、名 1-2 字）。'
    }
    if (numerology.unsupportedReason === 'stroke-missing') {
      const missing = numerology.missingChars?.join('”“') ?? ''
      return `“${missing}”暂缺姓名学笔画数据，无法推算该姓名的五格三才。`
    }
  }
  return ''
})

const sancaiText = computed(() => {
  const sancai = props.numerology.sancai
  if (!sancai) return null
  return {
    tian: `${sancai.tian.number}·${sancai.tian.element}${sancai.tian.yinYang}`,
    ren: `${sancai.ren.number}·${sancai.ren.element}${sancai.ren.yinYang}`,
    di: `${sancai.di.number}·${sancai.di.element}${sancai.di.yinYang}`,
    triple: sancai.triple,
    grade: sancai.grade,
  }
})

function elementColor(element: string): string {
  switch (element) {
    case '木':
      return '#3f8f4b'
    case '火':
      return '#c95b3f'
    case '土':
      return '#a9792f'
    case '金':
      return '#b0a33a'
    case '水':
      return '#3f6fb5'
    default:
      return '#8a8a8a'
  }
}

function gridLuckClass(lucky: string): string {
  switch (lucky) {
    case '吉':
      return 'luck-good'
    case '半吉':
      return 'luck-mid'
    default:
      return 'luck-bad'
  }
}

function sancaiClass(grade: string | null): string {
  if (!grade) return 'luck-none'
  if (grade === '大吉' || grade === '吉' || grade === '中吉') return 'luck-good'
  if (grade === '吉多于凶' || grade === '吉凶参半') return 'luck-mid'
  return 'luck-bad'
}

function roleLabel(role: string): string {
  return role === 'surname' ? '姓' : '名'
}
</script>

<template>
  <section class="numerology" aria-label="姓名数理（传统姓名学参考）">
    <div class="numerology-head">
      <h3>姓名数理 · 五格三才</h3>
      <span class="numerology-legend">传统姓名学 · 文化参考</span>
    </div>

    <p v-if="!numerology.supported" class="numerology-unavailable" role="note">
      {{ unavailableText }}
    </p>

    <template v-else>
      <ul class="stroke-line" aria-label="各字姓名学笔画">
        <li v-for="stroke in numerology.strokes" :key="`${stroke.role}-${stroke.char}`">
          <span class="stroke-char">{{ stroke.char }}</span>
          <b class="stroke-count">{{ stroke.stroke }}画</b>
          <em class="stroke-role">{{ roleLabel(stroke.role) }}</em>
        </li>
      </ul>

      <dl class="grid-list">
        <div
          v-for="row in gridRows"
          :key="row.key"
          class="grid-row"
          :title="row.reading.dayan.comment"
        >
          <dt class="grid-label">{{ row.label }}</dt>
          <dd class="grid-number">
            {{ row.reading.number }}
            <span
              class="grid-element"
              :style="{ color: elementColor(elementForNumber(row.reading.number)) }"
            >
              {{ elementForNumber(row.reading.number) }}
            </span>
          </dd>
          <span class="grid-sky">{{ row.reading.dayan.skyNine }}</span>
          <span v-if="row.reading.dayan.isMax" class="grid-max">最大好运数</span>
          <b class="grid-luck" :class="gridLuckClass(row.reading.dayan.lucky)">
            {{ row.reading.dayan.lucky }}
          </b>
        </div>
      </dl>

      <p v-if="sancaiText" class="sancai-line">
        <span class="sancai-label">三才配置</span>
        <span class="sancai-triple">{{ sancaiText.triple }}</span>
        <span class="sancai-detail">
          天 {{ sancaiText.tian }} · 人 {{ sancaiText.ren }} · 地 {{ sancaiText.di }}
        </span>
        <span class="sancai-grade" :class="sancaiClass(sancaiText.grade)">
          {{ sancaiText.grade ?? '未收录' }}
        </span>
      </p>
    </template>

    <p class="numerology-note">{{ numerology.note }}</p>
  </section>
</template>

<style scoped>
.numerology {
  margin: 1.25rem 0;
  padding: 1rem 1.1rem;
  background: #fffdf8;
  border: 1px solid #e6dccb;
  border-radius: 14px;
}

.numerology-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.8rem;
}

.numerology-head h3 {
  font-size: 1rem;
  color: #292421;
}

.numerology-legend {
  font-size: 0.75rem;
  color: #8a7d6b;
}

.numerology-unavailable {
  color: #9a6a2f;
  font-size: 0.88rem;
  line-height: 1.6;
}

.stroke-line {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.9rem;
}

.stroke-line li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.6rem;
  background: #f7efe2;
  border-radius: 999px;
}

.stroke-char {
  font-size: 1.05rem;
  font-weight: 600;
}

.stroke-count {
  color: #6d5b41;
  font-weight: 600;
}

.stroke-role {
  font-style: normal;
  color: #a08a6a;
  font-size: 0.72rem;
}

.grid-list {
  display: grid;
  gap: 0.35rem;
}

.grid-row {
  display: grid;
  grid-template-columns: 3.2rem 4rem 1fr auto auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  background: #fbf6ec;
}

.grid-label {
  font-weight: 600;
  color: #4a4034;
}

.grid-number {
  font-weight: 700;
  font-size: 1.05rem;
  color: #292421;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.grid-element {
  font-size: 0.85rem;
}

.grid-sky {
  font-size: 0.85rem;
  color: #5d5346;
}

.grid-max {
  font-size: 0.7rem;
  color: #8b2c2c;
  border: 1px solid #d9a8a0;
  border-radius: 999px;
  padding: 0 0.35rem;
}

.grid-luck,
.sancai-grade {
  font-size: 0.78rem;
  font-weight: 700;
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
}

.luck-good {
  color: #2e7d32;
  background: #e6f2e6;
}

.luck-mid {
  color: #9a6a1a;
  background: #f7eeda;
}

.luck-bad {
  color: #a8342e;
  background: #f6e5e2;
}

.luck-none {
  color: #6a6a6a;
  background: #ececec;
}

.sancai-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.7rem;
  padding-top: 0.6rem;
  border-top: 1px dashed #e6dccb;
}

.sancai-label {
  font-weight: 600;
  color: #4a4034;
}

.sancai-triple {
  color: #292421;
}

.numerology-note {
  margin-top: 0.65rem;
  font-size: 0.75rem;
  color: #9a8c78;
}
</style>
