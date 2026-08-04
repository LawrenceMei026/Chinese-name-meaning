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

## AI Infrastructure

- **Local ONNX**: Performs fast 10-class "vibe" prediction (Scholarly, Grand, etc.) in a Web Worker.
- **Internal LLM (Native)**: 
  - **Engine**: Powered by Rust `llama-cpp-2` (GGUF format) with a ChatML prompt.
  - **Distribution**: The installer does not bundle the 491,400,032-byte Qwen2.5 model. The desktop app downloads it on demand to `%LOCALAPPDATA%\Chinese Name Meaning Explorer\models`.
  - **Integrity**: The Hugging Face URL is pinned to a full revision. Downloads require a successful HTTP status and exact content length, stream through SHA-256 verification, use a cross-process lock and `.part` file, and install by same-directory atomic rename.
  - **Inference**: Native generation is single-flight. It has a 60s frontend timeout, backend cancellation, a 5s stop grace period, and at most three attempts. Each retry uses a distinct seed and includes the previous output plus its concrete rejection reason in the correction prompt.
  - **Output Contract**: Native summaries must be 80-130 Chinese characters and pass factual checks that reject prompt leakage, unsupported identity/biographical claims, English or Pinyin, and ungrounded historical context. Repeated names explain the character meaning once and may describe repetition, rhythm, and structure. Missing or unusable glosses require conservative structural wording rather than an invented meaning.
  - **Failure Semantics**: A timeout is shown as `原生 Qwen 生成超时，请重试。`; three rejected outputs are shown as `原生 Qwen 输出未通过事实检查，请重新分析。`; three runtime failures are shown as `原生 Qwen 运行失败，请重试。`. When the native model is available but fails this contract, do not present a deterministic template as if it were native Qwen output.
  - **Memory Check**: When the model is missing, the download dialog warns systems reporting less than 6GB RAM. It does not block download or later native inference.
  - **Architecture**: Bridged via Tauri commands (`check_model_exists`, `download_model`, `check_memory`, `generate_internal_summary`, `cancel_internal_summary`).
- **Legacy Ollama**: If native inference is unavailable without timing out, the app tries `name-expert` sequentially at `localhost:11434` and then `127.0.0.1:11434`, with a 45s timeout per address. The equivalent addresses are never invoked in parallel, avoiding duplicate generation. It then uses the deterministic summary fallback.

## Architecture Notes

The core data flow:
1. User inputs a Chinese name containing 2-4 characters in the current `U+4E00-U+9FA5` validator range (no Pinyin)
2. App validates the input, then segments the name into a single surname or common compound surname plus given-name characters.
3. Each character is looked up for definition, general pinyin, and tone from `chars.json`. Single-character surname context can override the reading from `surnames.json`; polyphonic compound surnames use the narrow `src/data/compoundSurnamePinyin.json` override table. Dictionary entries use a Chinese-first schema: `{ pinyin, tones, definition_cn, freq, radical }`.
4. Cultural context layer adds verified connotations, literary references, and naming trends (from `cultural.json` via `cultural.ts`). `isUsableCulturalData()` provides runtime isolation for unsafe records; redundant historical and phonological fields are excluded.
5. Results are rendered in a structured, readable layout

Dictionary data (`chars.json`, `surnames.json`) is preloaded on `onMounted` via `preloadDictionary()`. Keep general character readings in `chars.json` and surname-context readings in the surname data; do not overwrite the general reading to fix a surname. `nameAnalyzer.ts` filters empty or punctuation-only definition fragments at runtime, applies surname readings only after segmentation, and formats both numbered `v` and `u:` Pinyin as `ü` for display. The app does not support Pinyin as input. Production-data regressions belong in `src/__tests__/nameDataQuality.spec.ts`, not only mocked analyzer tests.

Missing modern definitions are repaired through `src/data/ccCedictDefinitionSupplements.json`, not by editing `chars.json` ad hoc. The overlay pins an official CC-CEDICT release and keeps the raw English gloss, reviewed Simplified Chinese translation, review state, source checksum, and license separate. Apply it with `npm run update:dictionary-supplements`; builds run `npm run check:dictionary-supplements` and fail if the generated dictionary drifts. Never automatically translate glosses or treat surname, pronunciation, dialect, variant, or character-formation notes as semantic definitions.

Bulk name-meaning review uses Unicode 17.0.0 Unihan `kDefinition` only as separately stored corroboration for a CC-CEDICT single-character semantic record. Each Simplified Chinese definition still requires human review. `npm run check:name-meaning-coverage` reproduces the runtime sanitation contract across all input-reachable Hanzi and locks the pending-review count; do not claim `chars.json.freq`, removed Kangxi imports, or third-party name corpora are population-level name frequency evidence.

Pure-Chinese definition review uses the fixed Chinese Wiktionary `2026-07-01` dump. Regenerate candidates with `npm run generate:zhwiktionary-review-queue -- <dump-path>` only after verifying the official SHA-1. Keep the generated queue unreviewed and separate from `src/data/zhWiktionaryDefinitionSupplements.json`; production entries require an immutable revision ID, selected definitions present in that revision, human-reviewed Simplified Chinese, and CC BY-SA 4.0 attribution. Never promote translations, pronunciation, etymology, variants, examples, dialect-only senses, names, or non-Chinese sections.

Guangyun data is a separate, optional historical display layer generated by `scripts/update-guangyun-data.mjs`. It pins `tshet-uinh-data` commit `21585e22c8a730ca2fd175112f4d18e16d5ce578` and its CC0 `廣韻.csv` checksum, preserving source headword, fanqie, direct reading, rhyme, phonological position, raw gloss, headword note, and gloss reference as separate fields. The UI option is off by default. Never merge this data into modern definitions, cultural meanings, model features, or Qwen prompts.

The curated cultural dataset currently contains 267 verified records. The previous mechanical Kangxi XLS batch is intentionally quarantined: fanqie, pronunciation notes, variant-form descriptions, character-shape analysis, measurement definitions, and generated `名字里常取...的感觉` prose are not cultural meanings. Preserve this distinction in importers, runtime filtering, tests, and build-time checks. The quality suite exhaustively covers all 267 single-character summaries and all 71,289 ordered two-character combinations.

The local AI layer is managed by `src/services/localInference.ts`. User cancellation is propagated through `AbortSignal`, and `App.vue` cancels active analysis on button press, new analysis, history restore, reset, and component unmount.
- **Worker Lifecycle**: The ONNX Worker uses a 10s Ping/Pong health check and a 10s inference timeout. Attempts are serialized, and Workers are terminated and recreated after timeout, abort, construction/postMessage failure, or a Worker-level error. A normal inference error response returns `null` without forcing replacement. Inference is attempted at most twice.
- **Model Loading**: The Web Worker (`localInference.worker.ts`) uses a static import of `onnxruntime-web` for stability. It attempts to use `webgpu` for acceleration with `wasm` as fallback. In Tauri production, `ort.env.wasm.wasmPaths` must be explicitly set to the origin base URL.
- **Asset Integrity**: The ONNX model MUST have all weights inlined (no `.data` external files). If files like `classifier.onnx.data` are generated, they must be removed and the model re-saved with `save_as_external_data=False`.
- **Production Pathing**: Bundled ONNX assets are fetched from the current Tauri/web application origin relative to Vite `BASE_URL`. `%LOCALAPPDATA%\Chinese Name Meaning Explorer\models` is used only for the downloaded native GGUF model.
- **Inference Summary**: Output summaries are dynamically synthesized using a hybrid approach:
    1. **Local ONNX**: Fast 10-class vibe prediction.
    2. **Native GGUF (Tauri)**: Preferred desktop summary generator when the validated model is installed.
    3. **Ollama (Local LLM)**: Secondary summary generator when native inference is unavailable and did not time out. Cross-interface development may require `OLLAMA_HOST=0.0.0.0` and `OLLAMA_ORIGINS="*"`.
    4. **Deterministic Fallback**: Rule-based narrative engine when no LLM summary succeeds.
- **Custom Model**: `NameExpert.modelfile` defines the AI persona. Create it via `ollama create name-expert -f NameExpert.modelfile`.
- **Feature Engineering**: Inference combines acoustic features (prosody/initials), radical analysis, and semantic dictionary scanning (beauty/strength/virtue/nature).
- **Diagnostics**: Health checks and inference lifecycle are logged via `[Worker]` and `[InferenceService]` console prefixes.
- **Fallback**: System automatically reverts to deterministic label matching if assets are missing or handshake fails.

## CI/CD 

- **GitHub Actions**: Automated release workflow is configured in `.github/workflows/release.yml`. Windows native builds require Node.js 24, Rust stable, CMake, LLVM/libclang, and the MSVC toolchain.
- **Pre-package Gates**: Before `tauri-apps/tauri-action@v0`, the workflow validates the release version, shared feature contract, complete Vitest suite, TypeScript types, read-only scoped lint, real ONNX WASM inference, Rust formatting, and `cargo check/test --locked`.
- **Read-only Lint**: Release lint runs Oxlint and ESLint only over `src`, `scripts`, `vite.config.ts`, and `eslint.config.ts`; do not add `--fix`, cache writes, or `public/` generated ONNX Runtime assets to this gate.
- **Dependency Security**: Keep both `npm audit --omit=dev` and `npm audit` at zero. The lockfile currently patches `postcss`, `protobufjs`, `shell-quote`, and `undici`; `minimatch@10.2.5` and `brace-expansion@5.0.8` are pinned through npm overrides until upstream chains update.
- **GitHub Connection**: Repository is connected to GitHub (`LawrenceMei026/Chinese-name-meaning`). Pushes to `main` and tags are handled via authenticated Git flow.
- **Package Version**: `0.1.6`; release tags must match the package and Tauri config version.
- **Trigger**: Push a tag starting with `v` (e.g., `git tag v1.0.0 && git push origin v1.0.0`).
- **Target**: Build and package for `windows-latest` (producing `.msi` and `.exe`).
- **External Links**: Desktop links must use `@tauri-apps/plugin-opener` so Windows opens the system default browser. Keep the Tauri URL scope restricted to `https://github.com/LawrenceMei026/Chinese-name-meaning*`; both source and feedback actions must use that canonical repository.

## Version Control

- Keep `COMMIT_PROGRESS.md` updated with a short entry for each commit.
- Treat that file as the running log of repository milestones and progress.
- Do not copy fields directly from the bundled Kangxi `xls` workbook into cultural meanings. Any coverage expansion requires a committed, deterministic importer that keeps fanqie, variant forms, and pronunciation notes separate from verified semantic glosses.
- Do not expand modern definitions from scraped Xinhua/Kangxi mirrors with an unclear rights chain. Use a pinned, redistributable source, preserve source glosses and license metadata, require human-reviewed Simplified Chinese translations, and apply changes through the deterministic dictionary supplement importer.
- `npm run check:cultural-data` is a release gate for all cultural and dictionary entries. Current maintenance priorities are truthful cultural coverage, release reproducibility, inference lifecycle correctness, model-contract integrity, and keeping dependency audits clean.
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
npm ci            # install exactly from package-lock.json
npm run dev       # dev server at http://localhost:5173
npm run build     # production build
npm run check:cultural-data  # audit all cultural and dictionary records
npm run check:tauri-acl  # verify event permissions and the repository URL scope
npm run type-check  # TypeScript check only
npm run test:features  # Python + Vitest feature contract
npm run test:unit -- --run  # complete Vitest suite once
npm run lint:check  # read-only scoped Oxlint + ESLint
npm run test:onnx  # real ONNX WASM inference smoke
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
  src-tauri/
    Cargo.lock                 # locked Rust graph required by release checks
    src/main.rs                # secure GGUF download and Tauri command lifecycle
    src/native_llm.rs          # llama.cpp-backed native generation
```
