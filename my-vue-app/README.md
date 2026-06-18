# my-vue-app

This Vue 3 app analyzes Chinese names character by character and explains the meaning, cultural context, and common naming associations behind each character.

## What it does

- Accepts Chinese names or pinyin input.
- Splits the name into surname and given-name characters.
- Looks up pronunciation and dictionary definitions from CC-CEDICT data.
- Adds curated cultural notes such as Five Elements, literary references, and naming connotations.
- Shows an optional local AI summary for extra tone labels when the ONNX model is available.
- Saves recent analyses in the browser so you can revisit them after a refresh.

## How it works

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
    src-tauri/
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
- `npm run test:e2e` - run Playwright end-to-end tests
- `npm run type-check` - run Vue/TypeScript type checking
- `npm run lint` - run all lint tasks
- `npm run lint:oxlint` - run Oxlint autofix
- `npm run lint:eslint` - run ESLint autofix with cache
- `npm run format` - format `src/` with Prettier
- `npm run tauri:dev` - launch the Tauri desktop shell
- `npm run tauri:build` - build the Tauri desktop bundle
