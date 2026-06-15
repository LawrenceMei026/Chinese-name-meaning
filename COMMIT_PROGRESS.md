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

## Commit 10 — Pinyin formatting hardening
- Tightened `src/services/nameAnalyzer.ts` so tone-mark placement trims and normalizes whitespace, preserves uppercase transliteration, and handles `v` as `ü`.
- Added regression tests for whitespace collapse, uppercase output, and `ü` syllables in `src/__tests__/nameAnalyzer.spec.ts`.
- Verified the app again with `npm run test:unit -- src/__tests__/nameAnalyzer.spec.ts` in `my-vue-app`.

## Commit 11 — Accessibility and analyzer polish
- Added richer empty/loading/busy states, better form semantics, and clearer focus feedback in `src/App.vue`.
- Expanded analyzer tests to cover trimmed input, unknown surname fallback, and more pinyin tone-placement cases.
- Verified the app again with `npm run test:unit` and `npm run type-check` in `my-vue-app`.

## Current checkpoint
- Task progress: accessibility/UI states and analyzer test coverage are both complete.
- The next active work is the analysis history feature.
- Keep the task order moving so the shared analyzer and UI flow stay stable.
