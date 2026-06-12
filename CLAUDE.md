# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A webpage that analyzes Chinese names and explains their meanings with cultural context. Users input a Chinese name and receive a breakdown of each character's meaning, cultural significance, historical connotations, and common associations in Chinese tradition.

## Tech Stack

- Frontend: Vue 3 (Composition API)
- Chinese character analysis: dictionary API or local dataset (e.g., CC-CEDICT)
- Optional AI layer: local on-device inference for cultural tone labels and a short evaluation

## Key Domain Concepts

- Chinese names typically have 2–3 characters: one surname (姓) followed by one or two given name characters (名)
- Each character carries independent meaning; the combination often has poetic or aspirational intent
- Cultural layers include Five Elements (五行), classical poetry references, gender connotations, and generational naming conventions
- Tone (声调) affects meaning — homophone characters can have very different connotations

## Architecture Notes

The core data flow:
1. User inputs a Chinese name (characters or pinyin)
2. App validates the input mode, then segments the name into surname + given name characters
3. Each character is looked up for definition, pinyin, and tone (from `chars.json`)
4. Cultural context layer adds connotations, literary references, and naming trends (from `cultural.ts`)
5. Results are rendered in a structured, readable layout

Dictionary data (`chars.json`, `surnames.json`) is preloaded on `onMounted` via `preloadDictionary()` so it's ready before the user submits. `loadData()` should check HTTP status before parsing JSON so fetch failures stay visible. The `analyzeName` function is safe to call immediately after — it awaits the same shared load promise.

Pinyin tone marks are formatted in `src/services/nameAnalyzer.ts`; keep the tone-placement rules accurate for multi-vowel syllables so `CharacterCard.vue` can display readable pinyin.

The local AI layer is intentionally lazy-loaded from `src/services/localInference.ts`. Keep it on-demand, deterministic when assets are missing, and isolated from the base analyzer so the page still works if model files are unavailable. The current direction is ONNX Runtime Web only, with a compact local model and a graceful fallback path.

## Development Commands

```bash
cd my-vue-app
npm install       # first time
npm run dev       # dev server at http://localhost:5173
npm run build     # production build
npm run type-check  # TypeScript check only
npm run test:unit  # Vitest unit tests
```

## Language

The UI is in Mandarin Chinese. All user-facing text, labels, error messages, and cultural explanations use Simplified Chinese. The `chars.json` dictionary definitions come from CC-CEDICT and remain in English (source limitation).

## Project Structure

```
my-vue-app/
  public/data/
    chars.json      # CC-CEDICT single-char entries (fetched at runtime) — definitions in English
    surnames.json   # CC-CEDICT surname entries
  src/
    types.ts                    # shared interfaces
    data/cultural.ts            # static curated cultural data (~70 characters) — all text in Mandarin
    services/nameAnalyzer.ts    # loads dict, segments name, builds result; exports preloadDictionary() and formatPinyin()
    services/localInference.ts  # lazy-loaded AI orchestration with deterministic fallback
    components/CharacterCard.vue  # all labels/strings in Mandarin
    App.vue                     # single-page input + results — all UI text in Mandarin; preloads dict on mount
```
