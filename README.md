# Chinese Name Meaning Explorer

A Mandarin-first Vue 3 app that analyzes Chinese names character by character and explains the meaning, cultural context, and common naming associations behind each字.

## What it does

- Accepts Chinese names or pinyin input.
- Splits the name into surname and given-name characters.
- Looks up pronunciation and dictionary definitions (Consolidated Chinese-first data).
- Adds curated cultural notes such as Five Elements, literary references, and naming connotations.
- Shows local AI deep analysis using a trained ONNX classifier (16-dimensional feature vector) with a dynamic, human-like narrative engine that explains the name's "vibe" and core meaning.
- Saves recent analyses in the browser so you can revisit them after a refresh.

## How it works

The main app lives in `my-vue-app/src/App.vue`.

1. The app preloads dictionary data on mount with `preloadDictionary()`.
2. User input is validated as Chinese characters or pinyin.
3. `analyzeName()` segments the input into surname + given name characters.
4. Each character is enriched with dictionary data and curated cultural context.
5. Results are rendered as structured cards with pronunciation, meaning, and notes.
6. If you open the AI analysis panel, `runLocalAiAnalysis()` triggers a Web Worker:
    - **Inference**: Predicts 6 cultural "vibes" (categories) using `classifier.onnx`.
    - **Synthesis**: Generates a unique summary by scrubbing academic jargon from dictionary data and weaving the predicted vibe with cultural tags (Five Elements/Literature).

## Project structure

```text
my-vue-app/
  public/
    data/
      chars.json      # Chinese-first dictionary (merged Xinhua)
      surnames.json
    models/
      classifier.onnx # Trained PyTorch MLP model
      manifest.json   # Model configuration
  src/
    App.vue
    ...
```

## Key features

- Chinese-name parsing with surname detection, including common compound surnames.
- Pinyin tone-mark formatting that keeps whitespace normalized and handles `v` as `ü`.
- Curated cultural annotations for common naming characters.
- Local AI fallback that still works when the model files are missing.
- Persistent history stored in `localStorage`.
- Accessible loading, error, and busy states.

## Data sources

- Dictionary data comes from CC-CEDICT and is loaded at runtime from `public/data/`, resolved relative to the Vite base path so subpath deployments keep working.
- Cultural annotations are stored in `src/data/cultural.json` and read through `src/data/cultural.ts`.
- The UI is written in Simplified Chinese, while CC-CEDICT definitions remain in English because of the source data.

## Local AI

The optional AI layer is lazy-loaded from `src/services/localInference.ts` and uses ONNX Runtime Web in a Web Worker.

- If the model assets are present, the worker can produce a local summary and tone labels without blocking the main thread.
- If the assets are missing, the app falls back to deterministic labels so the base analyzer still works.
- Saved history now restores the AI panel too when an entry already has AI output.
- The worker resolves model assets relative to the app base path, which keeps the optional AI flow working when the site is deployed under a subdirectory.

## Getting started

```bash
cd my-vue-app
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`.

## Windows exe bundling

Use Tauri to package the whole app into a Windows `.exe`:

1. Install dependencies in `my-vue-app` with `npm install`.
2. Run `npm run tauri:build` on Windows, not on Linux/WSL.
3. Make sure the Windows machine has Rust stable, the MSVC toolchain, and the Visual Studio C++ build tools installed.
4. Keep `my-vue-app/src-tauri/tauri.conf.json` pointing at `../dist` so Tauri packages the built Vue output.
5. Reuse the existing `public/favicon.ico` as the bundle icon or replace it with a proper desktop icon before release.
6. After the build finishes, grab the `.exe` from the Tauri bundle output under `my-vue-app/src-tauri/target/release/bundle/`.

## Available scripts

- `npm run dev` - start the Vite dev server
- `npm run build` - type-check and build for production
- `npm run preview` - preview the production build
- `npm run test:unit` - run Vitest unit tests
- `npm run type-check` - run Vue/TypeScript type checking
- `npm run lint` - run all lint tasks
- `npm run lint:oxlint` - run Oxlint autofix
- `npm run lint:eslint` - run ESLint autofix with cache
- `npm run format` - format `src/` with Prettier
- `npm run tauri:dev` - launch the Tauri desktop shell
- `npm run tauri:build` - build the Tauri desktop bundle

## Development notes

- User-facing copy is Simplified Chinese.
- Dictionary loading is prewarmed on mount so the first analysis is fast.
- `loadData()` checks fetch status before parsing JSON so asset failures stay visible.
- Analysis history is capped to a small recent window and stored under `analysis-history-v1`.
- The optional AI layer should remain separate from the core analyzer so the app still works without model files.
- The desktop bundle reuses the same frontend assets, so packaged builds still depend on the Vite output and base-path-safe asset URLs.

## Verification

```bash
cd my-vue-app
npm run test:unit
npm run type-check
npm run build
```

For a full UI check, run `npm run dev` and try a Chinese name, a pinyin input, and the history restore flow. For desktop packaging, run `npm run tauri:dev` locally and `npm run tauri:build` on Windows.
