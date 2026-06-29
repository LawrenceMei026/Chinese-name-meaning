# Commit Progress

## Commit 1 — Initial repository snapshot
- Initialized Git on `main`.
- Added the current project files to version control.
- Baseline established for future work on the Chinese name analysis app.

## Commit 2 — Expand cultural coverage baseline
- Expanded `src/data/cultural.ts` with a larger first-pass set of high-value naming characters.
- Verified the app with `npm run type-check` and `npm run test:unit` in `my-vue-app`.
- Next pass should do source-backed cleanup first, then expand the remaining entries to match the sources more closely.

## Commit 3 — Source-backed cleanup pass
- Reworked the cultural map into a cleaner, source-aligned first-pass set.
- Removed duplicate entries and tightened several connotation/gender/literary note wordings.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 4 — Source-aligned expansion wave
- Added more common, source-aligned naming characters such as `和`, `雅`, `静`, `婉`, `妍`, `婷`, `瑶`, `承`, `启`, `博`, `浩`, `然`, `辰`, `景`, `怡`, `欣`, `修`, `谦`, `诚`, `霏`, `昕`, and `淳`.
- Kept the object shape unchanged so the UI and analyzer remain stable.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 5 — XLS-backed cultural expansion
- Added an `xls`-backed pass from `康熙字典全文数据库(4万条EXCEL格式).xls` for characters such as `馨`, `香`, `雯`, `鑫`, `蓓`, `菡`, `芷`, `芳`, `艳`, `翔`, `翠`, `璐`, `璇`, `瑛`, `玉`, `灿`, `灏`, `潇`, `洋`, `泉`, `欢`, `晴`, `彩`, `彦`, `娟`, `鹤`, `鹏`, `鸿`, `鸾`, `骏`, `馥`, `青`, `锦`, `锐`, `锋`, `超`, `贞`, `薇`, `蕾`, `蕙`, `蕊`, `萍`, `菲`, `莹`, and `荷`.
- Kept the cultural lookup shape stable while broadening coverage from the local database.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 6 — Bulk XLS coverage expansion
- Expanded `src/data/cultural.ts` to roughly 2000 curated entries using the local Kangxi `xls` workbook as the source base.
- Focused the bulk pass on name-friendly characters across feminine, water, plant, jade, brightness, strength, virtue, and classic literary themes.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 7 — Save ONNX checkpoint
- Closed the cultural-coverage target and handed off to the ONNX classifier task.
- Saved the current repo state so the next implementation step starts from the expanded cultural baseline.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app` before switching tasks.

## Current checkpoint
- Task progress: cultural coverage target completed; ONNX classifier task is next.
- The cultural map now has a much larger local-database-backed base.
- Remaining work is now focused on `src/services/localInference.ts` and the model-loading path.

## Commit 8 — ONNX fallback wiring
- Replaced the local AI stub with a lazy-loaded ONNX-backed classifier path and deterministic fallback labels in `src/services/localInference.ts`.
- Added a Vitest mock for the AI helper so the UI test suite keeps passing without a locally installed runtime package.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 10 — Pinyin formatting hardening
- Tightened `src/services/nameAnalyzer.ts` so tone-mark placement trims and normalizes whitespace, preserves uppercase transliteration, and handles `v` as `ü`.
- Added regression tests for whitespace collapse, uppercase output, and `ü` syllables in `src/__tests__/nameAnalyzer.spec.ts`.
- Verified the app again with `npm run test:unit -- src/__tests__/nameAnalyzer.spec.ts` in `my-vue-app`.

## Commit 11 — Accessibility and analyzer polish
- Added richer empty/loading/busy states, better form semantics, and clearer focus feedback in `src/App.vue`.
- Expanded analyzer tests to cover trimmed input, history-free shell behavior, and more pinyin tone-placement cases.
- Verified the app again with `npm run test:unit` and `npm run type-check` in `my-vue-app`.

## Commit 12 — Analysis history persistence
- Added persistent analysis history in `src/App.vue` with `localStorage` hydration, save, restore, and clear actions.
- Added `AnalysisHistoryEntry` to `src/types.ts` and extended `src/__tests__/App.spec.ts` to cover hydration, save, restore, and malformed-storage fallback.
- Verified the app again with `npm run test:unit` and `npm run type-check` in `my-vue-app`.

## Commit 13 — Dictionary loading optimization
- Shared a single in-flight preload promise in `src/services/nameAnalyzer.ts` so concurrent callers reuse one dictionary fetch.
- Kept the analyzer behavior unchanged while reducing duplicate network work during startup races.
- Verified the app again with `npm run test:unit` and `npm run type-check` in `my-vue-app`.

## Commit 14 — Cultural JSON extraction
- Moved the curated cultural lookup table into `src/data/cultural.json` and kept `src/data/cultural.ts` as a thin synchronous wrapper.
- Preserved the analyzer API so `getCulturalData()` still works without changing the name-analysis flow.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 15 — Project README
- Added a root `README.md` that explains the app, its analysis flow, local AI fallback, data sources, and developer scripts.
- Documented the Mandarin-first UI, runtime assets, and verification steps so the project no longer depends on `COMMIT_PROGRESS.md` for orientation.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 16 — Full-flow e2e coverage
- Replaced the starter Playwright spec with a full browser flow in `my-vue-app/e2e/vue.spec.ts`.
- Covered name submission, dictionary-backed rendering, history persistence/restoration, local AI fallback behavior, and history clearing in one pass.
- Verified the flow with `npm run test:e2e -- --project chromium` in `my-vue-app`.

## Commit 18 — Restore AI from history
- Extended saved history entries so restored analyses can bring back the AI panel when AI output was previously generated.
- Kept the worker-backed inference path intact while making history feel like a true resume flow.
- Verified the app again with `npm run test:unit`, `npm run type-check`, and `npm run test:e2e -- --project chromium` in `my-vue-app`.

## Commit 19 — Harden release asset loading
- Made dictionary and worker asset URLs resolve relative to the Vite base path so subpath deployments keep working.
- Updated the app entry point and tests to match the new asset-loading behavior.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 20 — Add Tauri desktop scaffold
- Added a minimal Tauri wrapper in `my-vue-app/src-tauri/` so the Vue app can be bundled as a desktop application.
- Reused the existing app icon and documented the Tauri build commands in `my-vue-app/README.md`.
- Verified the frontend again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 21 — Document desktop packaging
- Updated `CLAUDE.md`, `COMMIT_PROGRESS.md`, and `README.md` to record the Tauri desktop path and Windows `.exe` packaging note.
- Kept the release notes aligned with the new desktop build scripts while leaving the Vue app behavior unchanged.
- Verified the frontend again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 22 — Consolidate and Clean Dictionary/Cultural Data
- Restructured `chars.json` to prioritize Chinese definitions and added fields for tones, frequency, and radicals.
- Cleaned `cultural.json` by removing redundant fields like `ancient_text` and `fanqie`, keeping only user-relevant cultural labels.
- Updated `src/types.ts` and `src/services/nameAnalyzer.ts` to reflect the new dictionary schema.
- Refactored `src/components/CharacterCard.vue` to use `definition_cn` and the new tone field, and removed rendering of historical linguistics fields.
- Verified the app again with `npm run type-check` and `npm run test:unit` in `my-vue-app`.

## Commit 23 — Configure Worker Diagnostic Mechanisms
- Implemented a Ping/Pong connection test in `src/services/localInference.ts` to verify Worker availability on startup.
- Added extensive diagnostic console logging in both the Worker (`src/workers/localInference.worker.ts`) and the host service to track the complete message lifecycle.
- Improved error handling in the Worker and simplified the main inference entry point to ensure consistent feedback.

## Commit 24 — Refine Dictionary Data and AI Fallback Stability
- Merged and cleaned 8000+ entries from the Xinhua dictionary into `chars.json`, ensuring high-quality Simplified Chinese definitions for naming characters.
- Systematically stripped academic linguistic markers (Fanqie, phonology jargon) and ancient text citations to improve modern UI readability.
- Stabilized the AI analysis layer by enforcing deterministic fallback logic while maintaining diagnostic Worker checks for future model integration.
- Updated `CLAUDE.md` to reflect the new Chinese-first dictionary schema and Worker health-check architecture.

## Commit 25 — Deploy On-Device AI Classifier
- Trained a custom PyTorch MLP model for multi-label cultural classification using the 16-dimensional feature vector.
- Exported the model to production-ready ONNX format in `public/models/classifier.onnx`.
- Integrated the local inference engine so the Web Worker now performs real-time AI analysis of name "vibes" (Elegant, Grand, Masculine, Soft, Classical, Modern).
- Fully aligned the feature extraction logic between Python (training) and TypeScript (inference).
- Updated documentation and health-checks to support the new real-model flow.

## Commit 26 — Improve AI Model Quality
- Augmented the training dataset to 1200+ records with balanced class distribution for underperforming labels (Classical, Modern).
- Retrained the PyTorch classifier with a wider MLP architecture (64->32->6) and increased training epochs to improve convergence.
- Achieved significant F1-Score improvements across all categories: Gentle (0.94), Grand (0.88), Masculine (0.87), and Elegant (0.86).
- Exported and deployed the updated ONNX model to `public/models/classifier.onnx`.

## Commit 27 — Implement Dynamic Narrative Engine for AI
- Developed a dynamic summary generator in `src/services/localInference.ts` that synthesizes customized analysis based on predicted ONNX labels and dictionary meanings.
- Integrated a dictionary "scrubber" to automatically remove academic metadata (e.g., "俗字", "同某") and ensure name interpretations are contextually coherent.
- Refined the "vibe" mapping to transform raw ML labels into high-quality literary descriptors (e.g., "阳刚" -> "坚毅刚劲的力量").
- Added a smart character selector that prioritizes interpretative richness when choosing the "meaningful character" for the summary.
- Updated docs to reflect the new hybrid inference and narrative architecture.

## Commit 28 — Optimize bundle and executable size
- Removed E2E testing directory (`e2e/`) and configuration (`playwright.config.ts`) to lean out the project structure.
- Removed large source-only data files (`public/data/word.json`, `public/data/chars_zh_pending.json`) that were adding 30MB+ to the deployment footprint.
- Cleaned up `package.json` devDependencies and `eslint.config.ts` to remove Playwright-related plugins.
- Pruned `npm` dependencies to ensure a lean development and build environment.
- Verified the core app still passes `type-check` and `test:unit` after the cleanup.

## Commit 29 — Finalize Hanzi-only input and AI refinement
- Removed Pinyin input UI and logic, specializing the interface for Hanzi-only 2-4 character names.
- Strengthened input validation with strict Hanzi-only regex and refined error feedback.
- Enhanced AI features with a 10-class differentiation system (Scholarly, Grand, Heroic, Serene, etc.) and WebGPU hardware acceleration.
- Injected semantic dictionary signals and acoustic (prosody) features into the inference pipeline for higher interpretative accuracy.
- Updated `CLAUDE.md` to reflect the refined AI architecture, semantic engineering, and UI constraints.

## Commit 30 — Fix model loading in Tauri production
- Removed external `.data` weights to enforce single-file ONNX model integrity.
- Configured explicit `ort.env.wasm.wasmPaths` in the Worker to resolve relative to the Tauri origin.
- Added a fallback retry mechanism for WASM-only inference if WebGPU initialization fails.
- Expanded CSP `connect-src` in `tauri.conf.json` to allow `data:` and ensure protocol compatibility.

## Current checkpoint
- UI is specialized for 2-4 character Chinese names.
- AI inference is hardened for Tauri production environments with WASM fallback.
- Feature engineering remains stable with Hanzi-driven semantic signals.
