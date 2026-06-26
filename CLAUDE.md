# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A webpage that analyzes Chinese names and explains their meanings with cultural context. Users input a Chinese name and receive a breakdown of each character's meaning, cultural significance, historical connotations, and common associations in Chinese tradition.

## Tech Stack

- Frontend: Vue 3 (Composition API)
- Chinese character analysis: dictionary API or local dataset (e.g., CC-CEDICT)
- Optional AI layer: local on-device inference for cultural tone labels and a short evaluation
- Desktop packaging: Tauri for native app builds, including Windows `.exe` output

## Key Domain Concepts

- Chinese names typically have 2–4 characters: one surname (姓) followed by 1–3 given name characters (名)
- Each character carries independent meaning; the combination often has poetic or aspirational intent
- Cultural layers include Five Elements (五行), classical poetry references, gender connotations, and generational naming conventions
- Tone (声调) affects meaning — homophone characters can have very different connotations
- Dictionary data is optimized for modern Chinese readability: academic linguistic markers (Fanqie, ancient phonetics) and historical philology notes (e.g., "x-is-phonetic") are stripped to keep definitions concise.

## Architecture Notes

The core data flow:
1. User inputs a Chinese name (2-4 Chinese characters only, no Pinyin)
2. App validates the input as pure Chinese characters, then segments the name into surname + given name characters
3. Each character is looked up for definition, pinyin, and tone (from `chars.json`). Dictionary entries use a Chinese-first schema: `{ pinyin, tones, definition_cn, freq, radical }`.
4. Cultural context layer adds connotations, literary references, and naming trends (from `cultural.json` via `cultural.ts`). Redundant historical fields are excluded.
5. Results are rendered in a structured, readable layout

Dictionary data (`chars.json`, `surnames.json`) is preloaded on `onMounted` via `preloadDictionary()`. The dictionary includes content merged from multiple Chinese sources (like Xinhua Dictionary) and is periodically cleaned via Python scripts to remove academic jargon. Pinyin tone marks are formatted in `src/services/nameAnalyzer.ts` for display only; the app does not support pinyin as input.

The local AI layer is managed by `src/services/localInference.ts`. It includes a health-check mechanism (Ping/Pong) with a 10s timeout to verify Worker availability.
- **Model Loading**: The Web Worker (`localInference.worker.ts`) uses a static import of `onnxruntime-web` for stability. It attempts to use `webgpu` for acceleration with `wasm` as fallback.
- **Asset Integrity**: The ONNX model MUST have all weights inlined (no `.data` external files). If regenerating, use `onnx.save_model(model, path, save_as_external_data=False)` to ensure a single-file deployment (< 100KB).
- **Inference Summary**: Output summaries are dynamically synthesized using a hybrid approach: combining 10-class ONNX label predictions (refined for scholarly/heroic/serene vibes) with a rule-based narrative engine that extracts core dictionary meanings and filters metadata noise.
- **Feature Engineering**: Inference combines acoustic features (prosody/initials), radical analysis, and semantic dictionary scanning (beauty/strength/virtue/nature).
- **Diagnostics**: Health checks and inference lifecycle are logged via `[Worker]` and `[InferenceService]` console prefixes.
- **Fallback**: System automatically reverts to deterministic label matching if assets are missing or handshake fails.

## Version Control

- Keep `COMMIT_PROGRESS.md` updated with a short entry for each commit.
- Treat that file as the running log of repository milestones and progress.
- When expanding cultural coverage, prefer the local `xls` workbook in the bundled Kangxi database folder and keep each batch source-aligned.
- Cultural coverage now has a large local-database-backed base; the next active implementation target is the ONNX classifier in `src/services/localInference.ts`.
- Keep following the active task plan without pausing between task-sized batches.
- Refresh this file with any new durable workflow preferences learned during the task.
- Keep the current checkpoint summaries aligned with the active task list so future sessions can resume cleanly.
- When a markdown edit fails, assume the file changed under you or the replacement block was too broad. Re-read the current file and patch the smallest unique snippet instead of replacing a large section.
- Preferred fixes for failed markdown updates: 1) re-read the exact file state, 2) edit a smaller unique block, 3) avoid stale whole-file replacements, 4) if the file is already drifting, update the tail-only checkpoint text first.
- When editing larger markdown files, prefer tail-only checkpoint updates or a small unique block over whole-file replacement; the file often changes between reads during active tasks, and stale broad replacements are the main source of failed edits.
- If an edit tool call reports a mismatch, treat it as a signal that the file drifted. Re-read the exact region you need, then patch only that region instead of retrying the same broad block.
- The desktop packaging path is Tauri in `my-vue-app/src-tauri/`; keep the config minimal and preserve the existing Vue app as the frontend shell.

```bash
cd my-vue-app
npm install       # first time
npm run dev       # dev server at http://localhost:5173
npm run build     # production build
npm run type-check  # TypeScript check only
npm run test:unit  # Vitest unit tests
npm run tauri:dev  # desktop wrapper during development
npm run tauri:build  # desktop bundle, including Windows .exe output on Windows
```

## Language

The UI is in Mandarin Chinese. All user-facing text, labels, error messages, and cultural explanations use Simplified Chinese. The `chars.json` dictionary definitions are primarily in Chinese (consolidated from multiple sources).

## Project Structure

```
my-vue-app/
  public/data/
    chars.json      # Consolidated character dictionary with Chinese definitions
    surnames.json   # CC-CEDICT surname entries
  src/
    types.ts                    # shared interfaces
    data/cultural.ts            # wrapper around cultural.json for synchronous lookup
    data/cultural.json          # curated cultural metadata map in JSON
    services/nameAnalyzer.ts    # loads dict, segments name, builds result; exports preloadDictionary() and formatPinyin()
    services/localInference.ts  # lazy-loaded AI orchestration with deterministic fallback
    workers/localInference.worker.ts  # ONNX session and inference on a worker thread
    components/CharacterCard.vue  # all labels/strings in Mandarin
    App.vue                     # single-page input + results — all UI text in Mandarin; preloads dict on mount
    src-tauri/                  # minimal Tauri wrapper for desktop packaging
```
