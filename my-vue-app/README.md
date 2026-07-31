# my-vue-app

This Vue 3 app analyzes Chinese names character by character and explains the meaning, cultural context, and common naming associations behind each character.

## What it does

- Accepts names containing 2-4 characters in the current `U+4E00-U+9FA5` validator range; pinyin input is not supported.
- Splits the name into surname and given-name characters.
- Looks up pronunciation and dictionary definitions from CC-CEDICT data.
- Adds curated cultural notes such as Five Elements, literary references, and naming connotations.
- Uses the bundled ONNX model for 10-class tone labels and a layered local summary path: native GGUF, Ollama, then deterministic fallback.
- Saves recent analyses in the browser so you can revisit them after a refresh.

## How it works

1. The app preloads dictionary data on mount with `preloadDictionary()`.
2. User input is validated as 2-4 characters in the `U+4E00-U+9FA5` range.
3. `analyzeName()` segments the input into surname + given name characters.
4. Each character is enriched with dictionary data and curated cultural context.
5. Results are rendered as structured cards with pronunciation, meaning, and notes.
6. If you open the AI analysis panel, `runLocalAiAnalysis()` runs ONNX labels in a Worker, prefers native GGUF generation in Tauri, tries local Ollama when appropriate, and finally builds a deterministic summary.

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
    Cargo.lock
    src/main.rs
    src/native_llm.rs
```

## Key features

- Chinese-name parsing with surname detection, including common compound surnames.
- Context-aware surname readings from `public/data/surnames.json`, plus explicit readings for polyphonic compound surnames in `src/data/compoundSurnamePinyin.json`.
- Pinyin tone-mark formatting that keeps whitespace normalized and handles both `v` and `u:` as `ü`.
- Runtime cleanup that replaces punctuation-only surname definitions with useful surname context and hides equivalent given-name fragments.
- Curated cultural annotations for common naming characters.
- Local AI fallback that still works when the model files are missing.
- Persistent history stored in `localStorage`.
- Accessible loading, error, and busy states.

## Data sources

- Dictionary data comes from CC-CEDICT and is loaded at runtime from `public/data/`, resolved relative to the Vite base path so subpath deployments keep working.
- `chars.json` stores general character readings. `surnames.json` stores single-character surname readings and is applied only when segmentation identifies a one-character surname. The explicit compound-surname table is intentionally small and only overrides readings that cannot be inferred safely from general character data.
- Cultural annotations are stored in `src/data/cultural.json` and read through `src/data/cultural.ts`.
- The UI and normalized dictionary definitions are primarily Simplified Chinese.
- `src/__tests__/nameDataQuality.spec.ts` loads the production JSON files and guards real polyphonic surname and dirty-definition cases.

## Local AI

The optional AI layer is orchestrated by `src/services/localInference.ts`.

- The bundled ONNX model runs in a serialized Web Worker and produces 10 tone labels. Worker health checks and inference use a 10-second timeout, with at most two attempts. Workers are replaced after timeout, abort, construction/postMessage failure, or a Worker-level error; a normal inference error response returns `null` without forcing replacement.
- In Tauri, a validated native Qwen2.5 GGUF is preferred for the narrative. Native generation is single-flight, uses a 60-second timeout, sends backend cancellation, waits up to 5 seconds before a timeout retry, and attempts at most twice.
- When native inference is unavailable without timing out, Ollama is tried sequentially at `localhost:11434` and then `127.0.0.1:11434`, with a 45-second timeout per address. The equivalent addresses are not called in parallel, preventing duplicate generation.
- If no model path succeeds, the app falls back to deterministic labels and narrative text.
- The same AI button cancels active analysis. New analysis, history restore, reset, and component unmount also propagate cancellation.
- Saved history now restores the AI panel too when an entry already has AI output.
- The worker resolves model assets relative to the app base path, which keeps the optional AI flow working when the site is deployed under a subdirectory.

### Desktop GGUF download

- The installer does not bundle GGUF weights. The app downloads a 491,400,032-byte Qwen2.5 0.5B Q4_K_M model to `%LOCALAPPDATA%\Chinese Name Meaning Explorer\models`.
- The Hugging Face URL is pinned to a full revision. The downloader checks HTTP status and content length, streams SHA-256 validation into a `.part` file, uses a cross-process lock, and atomically renames only a verified model.
- When the model is missing, the download dialog warns systems reporting less than 6GB RAM. The warning does not block download or later native inference.

## Getting started

```bash
npm ci
npm run dev
```

The dev server runs at `http://localhost:5173`.

## Windows exe bundling

Use Tauri to package the whole app into a Windows `.exe`:

1. Install locked dependencies in `my-vue-app` with `npm ci`.
2. Run `npm run tauri:build` on Windows, not on Linux/WSL.
3. Make sure the Windows machine has Rust stable, MSVC, Visual Studio C++ build tools, CMake, and LLVM/libclang installed.
4. Keep `my-vue-app/src-tauri/tauri.conf.json` pointing at `../dist` so Tauri packages the built Vue output.
5. The bundle icon is `src-tauri/icons/icon.ico`.
6. After the build finishes, grab the `.exe` from the Tauri bundle output under `my-vue-app/src-tauri/target/release/bundle/`.

## Available scripts

- `npm run dev` - start the Vite dev server
- `npm run build` - type-check and build for production
- `npm run preview` - preview the production build
- `npm run test:features` - run the shared Python and TypeScript feature-contract tests
- `npm run test:unit -- --run` - run the complete Vitest suite once
- `npm run test:onnx` - create an ONNX WASM session and execute the bundled classifier
- `npm run type-check` - run Vue/TypeScript type checking
- `npm run lint:check` - run read-only Oxlint and ESLint checks over project-owned source, scripts, and configuration
- `npm run lint` - run the development autofix lint tasks
- `npm run lint:oxlint` - run Oxlint autofix
- `npm run lint:eslint` - run ESLint autofix with cache
- `npm run format` - format `src/` with Prettier
- `npm run tauri:dev` - launch the Tauri desktop shell
- `npm run tauri:build` - build the Tauri desktop bundle

## Release quality gates

The tag-triggered Windows workflow in `.github/workflows/release.yml` runs every quality gate before `tauri-apps/tauri-action@v0` packages the desktop release:

1. Release tag and package/config version consistency.
2. Python and Vitest feature-contract tests.
3. The complete Vitest unit suite.
4. Vue/TypeScript type checking.
5. Read-only Oxlint and ESLint checks. These commands do not use `--fix`, cache writes, or workspace-wide scanning, and do not inspect generated ONNX Runtime assets in `public/`.
6. A real ONNX Runtime Web WASM inference against `public/models/classifier.onnx`, including tensor-name, output-size, and finite-value validation.
7. `cargo fmt --check`, `cargo check --locked`, and `cargo test --locked` in `src-tauri/`.

Run `npm audit --omit=dev` and `npm audit` when changing dependencies. The committed lockfile currently resolves patched versions of `postcss`, `protobufjs`, `brace-expansion`, `shell-quote`, and `undici`; both audits report zero vulnerabilities. `package.json` pins compatible patched `minimatch` and `brace-expansion` overrides until their upstream dependency chains adopt those versions directly.
