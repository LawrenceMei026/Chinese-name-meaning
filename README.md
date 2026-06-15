# Chinese Name Meaning Explorer

A Mandarin-first Vue 3 app that analyzes Chinese names character by character and explains the meaning, cultural context, and common naming associations behind each字.

## What it does

- Accepts Chinese names or pinyin input.
- Splits the name into surname and given-name characters.
- Looks up pronunciation and dictionary definitions from CC-CEDICT data.
- Adds curated cultural notes such as Five Elements, literary references, and naming connotations.
- Shows an optional local AI summary for extra tone labels when the ONNX model is available.
- Saves recent analyses in the browser so you can revisit them after a refresh.

## How it works

The main app lives in `my-vue-app/src/App.vue`.

1. The app preloads dictionary data on mount with `preloadDictionary()`.
2. User input is validated as Chinese characters or pinyin.
3. `analyzeName()` segments the input into surname + given name characters.
4. Each character is enriched with dictionary data and curated cultural context.
5. Results are rendered as structured cards with pronunciation, meaning, and notes.
6. If you open the AI analysis panel, `runLocalAiAnalysis()` offloads ONNX evaluation to a Web Worker and falls back to deterministic local labels when the model path is unavailable.

## Project structure

```text
my-vue-app/
  public/data/
    chars.json
    surnames.json
  src/
    App.vue
    types.ts
    data/cultural.ts
    data/cultural.json
    services/nameAnalyzer.ts
    services/localInference.ts
    workers/localInference.worker.ts
    components/CharacterCard.vue
```

## Key features

- Chinese-name parsing with surname detection, including common compound surnames.
- Pinyin tone-mark formatting that keeps whitespace normalized and handles `v` as `ü`.
- Curated cultural annotations for common naming characters.
- Local AI fallback that still works when the model files are missing.
- Persistent history stored in `localStorage`.
- Accessible loading, error, and busy states.

## Data sources

- Dictionary data comes from CC-CEDICT and is loaded at runtime from `public/data/`.
- Cultural annotations are stored in `src/data/cultural.json` and read through `src/data/cultural.ts`.
- The UI is written in Simplified Chinese, while CC-CEDICT definitions remain in English because of the source data.

## Local AI

The optional AI layer is lazy-loaded from `src/services/localInference.ts` and uses ONNX Runtime Web in a Web Worker.

- If the model assets are present, the worker can produce a local summary and tone labels without blocking the main thread.
- If the assets are missing, the app falls back to deterministic labels so the base analyzer still works.

## Getting started

```bash
cd my-vue-app
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`.

## Available scripts

From `my-vue-app/package.json`:

- `npm run dev` - start the Vite dev server
- `npm run build` - type-check and build for production
- `npm run preview` - preview the production build
- `npm run test:unit` - run Vitest unit tests
- `npm run test:e2e` - run Playwright end-to-end tests
- `npm run type-check` - run Vue/TypeScript type checking
- `npm run lint` - run all lint tasks
- `npm run lint:oxlint` - run Oxlint autofix
- `npm run lint:eslint` - run ESLint autofix with cache
- `npm run format` - format `src/` with Prettier

## Development notes

- User-facing copy is Simplified Chinese.
- Dictionary loading is prewarmed on mount so the first analysis is fast.
- `loadData()` checks fetch status before parsing JSON so asset failures stay visible.
- Analysis history is capped to a small recent window and stored under `analysis-history-v1`.
- The optional AI layer should remain separate from the core analyzer so the app still works without model files.

## Verification

```bash
cd my-vue-app
npm run test:unit
npm run type-check
npm run build
```

For a full UI check, run `npm run dev` and try a Chinese name, a pinyin input, and the history restore flow.
