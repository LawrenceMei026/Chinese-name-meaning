# Local AI Reliability Hardening Plan

## Purpose

This document is the implementation source of truth for hardening local AI reliability in `my-vue-app`.
Future work on local AI reliability should follow this file unless a newer approved plan supersedes it.

## Goals

The local AI pipeline should satisfy five core properties:

1. Facts are preserved and never invented.
2. Model artifacts and runtime identity are verifiable.
3. Failures degrade safely instead of silently producing misleading output.
4. Every result is traceable to its provider, policy version, and validation path.
5. End-to-end latency remains bounded by an explicit SLA.

## Current Reliability Assessment

The current implementation already has a solid baseline:

- structured name analysis before AI generation
- ONNX worker isolation and retry
- native GGUF model download with SHA-256 verification
- deterministic summary fallback
- cancellation plumbing across worker, native, and Ollama paths
- output rejection for prompt leakage, biographies, and unsupported historical claims

The main remaining weaknesses are architectural rather than purely prompt-related:

- generated summaries are validated mostly with denylist rules instead of a positive fact-preservation contract
- the native in-memory GGUF runtime is not bound to the configured model path identity
- native model availability is revalidated by hashing the full 491 MB model too often
- ONNX labels are accepted without confidence calibration and always return top 3
- provider failures are not consistently downgraded to deterministic safe output
- result provenance is incomplete and partly mislabeled

## Priority Risk List

### P0

- Summary validation is denylist-heavy and does not prove required meanings were preserved.
- Native loaded GGUF model is not bound to the configured model path.
- `check_model_exists()` hashes the full model repeatedly, causing avoidable I/O and timeout risk.
- There is no single end-to-end latency budget across worker, native, and Ollama stages.

### P1

- ONNX always returns top 3 labels without confidence thresholds or abstention.
- Native runtime failures currently hard-fail instead of consistently degrading to safe deterministic output.
- `loadedFromCache` does not mean cache and should be replaced with explicit provenance fields.
- ONNX artifact identity is not fully bound to manifest digest and label order validation.
- Classifier quality is not evidenced by a reviewed real-name evaluation set.

### P2

- Error handling depends on exact Chinese message text in the UI.
- History entries do not store AI provenance or validator version.
- Real worker and Tauri integration coverage is still limited.

## Target Architecture

The local AI system should be structured as follows:

```text
AnalyzedName
  -> GroundingFactPacket
      -> label classification
          -> ONNX with confidence gating
          -> rules fallback or abstain
      -> deterministic factual draft
      -> optional generative polishing
          -> native Qwen
          -> Ollama
          -> direct deterministic output when generators fail
      -> positive factual validation
      -> provenance-rich AiAnalysisResult
```

Core rule:

> Deterministic factual content is authoritative. Generative models may only polish language within a narrow validated envelope.

## Workstream 1: Unified Grounding Fact Packet

### Objective

Create a single normalized fact packet consumed by:

- ONNX feature extraction
- rules fallback classification
- deterministic summary builder
- native prompt builder
- Ollama prompt builder
- summary validator

### Required new shape

```ts
interface GroundingFactPacket {
  schemaVersion: 'grounding-facts-v1'
  name: string
  surname: string
  givenName: string
  structure: {
    isCompoundSurname: boolean
    isSingleCharacterGivenName: boolean
    isRepeatedGivenName: boolean
  }
  characters: Array<{
    char: string
    role: 'surname' | 'given'
    meaning: string | null
    meaningSource:
      | 'curated-local-gloss'
      | 'reviewed-connotation'
      | 'reviewed-dictionary'
      | 'none'
    evidenceId?: string
    literaryReference?: {
      text: string
      source: string
      evidenceId: string
    }
  }>
}
```

### Implementation rules

1. The packet must explicitly encode missing meanings as `null` rather than allowing generators to infer them.
2. Name-style classification should use given-name characters only.
3. Summary generation should use the same normalized meanings as feature extraction.
4. Meaning precedence should remain:
   - `cultural.localGloss`
   - reviewed connotation
   - cleaned reviewed dictionary meaning
5. Shared normalization logic should replace the current split between `cleanDefinition()` and weaker classifier-side sanitation.

### Deliverables

- new grounding fact builder module
- refactor of summary builder to consume fact packet only
- refactor of label fallback to consume fact packet only
- tests proving shared normalization across classifier and summary paths

## Workstream 2: Positive Summary Validation Contract

### Objective

Replace mostly denylist-based acceptance with a positive contract that proves required facts were preserved.

### Validation stages

#### Stage A: Format validation

The accepted summary must:

- start with `在“姓名”中，`
- contain the exact analyzed name
- contain only allowed scripts and punctuation
- contain no headings, lists, field-style output, or prompt echoes
- be normalized for whitespace before validation and before returning to the UI
- satisfy explicit Hanzi and total-length bounds

#### Stage B: Fact coverage validation

The accepted summary must:

- preserve each known given-name meaning
- preserve reviewed literary references when present
- avoid explaining unknown given-name characters
- avoid explaining the same repeated character twice in a repeated-name case
- avoid converting surname semantics into given-name meaning claims

To support this, reviewed meaning records should eventually include validation anchors such as:

```json
{
  "char": "宁",
  "requiredAny": ["安宁", "平和"],
  "forbiddenExtensions": ["命运", "仕途"]
}
```

#### Stage C: Risk rejection validation

Continue to reject:

- biographies
- courtesy-name or pen-name patterns
- birthplace and identity claims
- historical narrative additions
- unsupported political, military, ethnic, or achievement claims
- unsupported personality, behavior, future, or fate claims

### Replace plain-string rejection with structured codes

```ts
type SummaryRejectionCode =
  | 'wrong-opening'
  | 'name-missing'
  | 'known-meaning-missing'
  | 'literary-reference-missing'
  | 'unknown-meaning-invented'
  | 'unsupported-personality-claim'
  | 'biography-claim'
  | 'historical-claim'
  | 'prompt-leak'
  | 'invalid-script'
  | 'too-short'
  | 'too-long'
```

UI text should be mapped from codes instead of matching Chinese message strings.

### Additional rule

Corrective retries must not inject the full rejected hallucinated output back into the prompt. Use structured rejection feedback instead.

## Workstream 3: Deterministic Draft First, Generative Polish Second

### Objective

Move the system toward a safer composition strategy where deterministic factual sentences are authoritative and generator output has a smaller free-text surface.

### Strategy

1. Keep core meaning sentences deterministic.
2. Restrict generators to bridging or polishing language only.
3. If generated output fails validation, fall back to deterministic text instead of failing the entire user-visible result.

### Recommended structure

```text
Fixed factual sentence(s)
  + optional generated style sentence(s)
  + fixed concluding factual sentence
```

This minimizes the blast radius of a small model hallucinating unsupported semantics.

## Workstream 4: Native GGUF Runtime Identity and Validation

### Objective

Guarantee that the verified model file is the same model actually used in memory.

### Current weakness

`LlamaRuntime` caches only `Option<LlamaModel>`. Once loaded, later calls may continue using a model from an old directory even after the configured model path changes.

### Target state

Replace the current runtime state with something conceptually equivalent to:

```rust
struct LoadedModel {
    canonical_path: PathBuf,
    size: u64,
    modified: SystemTime,
    sha256: String,
    revision: &'static str,
    model: LlamaModel,
}
```

### Rules

1. Canonicalize the configured path before validation and load.
2. Bind the loaded model to the validated canonical path and digest.
3. Reload if path, size, digest, revision, or relevant metadata changes.
4. Do full integrity validation at the model-loading boundary rather than relying on a separate frontend precheck as the final authority.

### Hashing policy

Full SHA-256 validation should run when:

- the model is downloaded
- the application loads the model for the first time in a process
- the configured model path changes
- file metadata indicates the model may have changed
- the user explicitly requests revalidation

Normal AI analyses should not hash the entire 491 MB file every time.

## Workstream 5: End-to-End Failure and Degradation Policy

### Objective

Make the pipeline reliably return the safest available result rather than treating generator failures as all-or-nothing.

### Target policy matrix

| Failure type | Native retry | Ollama | Deterministic output | Notes |
|---|---:|---:|---:|---|
| user cancelled | no | no | no | propagate cancellation only |
| model missing | no | yes | yes | normal downgrade |
| model invalid | no | optional | yes | explicit invalid-model status |
| native runtime failure | limited | yes | yes | deterministic output remains safe |
| native quality rejection | limited corrective retry | optional | yes | show deterministic if correction still fails |
| native timeout with confirmed stop | limited | optional | yes | safe downgrade |
| native timeout without confirmed stop | no | no | yes | avoid concurrent extra model work |
| Ollama unavailable | n/a | next endpoint | yes | fallback should remain silent and safe |
| Ollama quality rejection | limited semantic retry | no | yes | deterministic output still returned |

### Key principle

Generator failure should not block deterministic factual output unless the user explicitly cancelled.

## Workstream 6: Unified Time Budget

### Objective

Introduce one overall inference deadline rather than letting worker, native, and Ollama timeouts accumulate serially.

### Recommended budgets

Desktop with native path available:

- ONNX worker classify: up to 8s
- native generation first attempt: up to 35s
- native corrective retry: up to 20s
- cancellation confirmation and orchestration overhead: remaining budget
- total target SLA: about 75s max

No native path available:

- ONNX worker classify: up to 8s
- Ollama primary endpoint: up to 30s
- deterministic fallback immediately after
- total target SLA: about 45s max

### Implementation note

Use a shared budget object so each phase consumes from one common deadline.

## Workstream 7: ONNX Classifier Reliability and Confidence

### Objective

Make style-label outputs calibrated, bounded, and auditable.

### Required changes

1. Stop always returning top 3 labels.
2. Add confidence thresholds per label.
3. Add minimum margin or equivalent acceptance logic.
4. Support abstention when confidence is too low.
5. Remove the universal fallback bias toward `书卷` when no rule truly matches.

### Runtime validation additions

The worker should validate:

- manifest label order equals `FEATURE_CONTRACT.labels`
- ONNX output values are finite
- output tensor shape and type match expectations
- model file digest and size match manifest

### Manifest additions

`public/models/manifest.json` should eventually include:

- model SHA-256
- model size
- feature contract version
- training manifest version
- input and output tensor names
- output tensor type and shape

## Workstream 8: Classifier Training and Evaluation Quality

### Objective

Move from synthetic-only training confidence to measurable reviewed evaluation quality.

### Required dataset work

1. Build a reviewed real-name evaluation set.
2. Track acceptable and unacceptable labels per reviewed name.
3. Split training and test sets without leakage across near-duplicate names.
4. Preserve dataset provenance and hashes.

### Required release metrics

- precision, recall, F1 per label
- macro and micro F1
- top-1 and top-2 hit rate
- abstention precision after thresholding
- calibration metrics such as ECE

### Release rule

The classifier should not be updated in production without meeting an explicit minimum precision target.

## Workstream 9: Result Provenance and History Schema

### Objective

Ensure every AI result can explain how it was produced.

### Replace current ambiguous fields

Current `loadedFromCache` is misleading and should be replaced.

### Suggested shape

```ts
interface AiAnalysisResult {
  schemaVersion: 'ai-analysis-v2'
  labels: Array<{ label: string; confidence: number | null }>
  labelSource: 'onnx' | 'rules' | 'none'
  labelStatus: 'accepted' | 'abstained' | 'fallback'
  summary: string
  summarySource: 'native-qwen' | 'ollama' | 'deterministic'
  generationStatus: 'accepted' | 'quality-rejected' | 'provider-unavailable' | 'provider-timeout'
  provenance: {
    appVersion: string
    featureContractVersion: string
    groundingPolicyVersion: string
    validatorVersion: string
    classifierModelVersion?: string
    classifierModelSha256?: string
    generatorModelRevision?: string
    generatedAt: number
  }
}
```

### History requirements

1. Version history entries with a schema version.
2. Persist AI provenance alongside the summary.
3. Mark older history items as legacy rather than silently treating them as current-policy output.
4. Fix the current issue where newly created history entries may not immediately receive the subsequent AI result if the new entry ID is not made active at creation time.

## Workstream 10: Typed Errors, Status Machine, and Observability

### Objective

Make runtime behavior easier to debug, safer to surface in the UI, and more robust to refactors.

### Typed failure codes

Introduce inference error codes such as:

```ts
type InferenceFailureCode =
  | 'cancelled'
  | 'deadline-exceeded'
  | 'classifier-unavailable'
  | 'classifier-invalid-output'
  | 'native-model-missing'
  | 'native-model-invalid'
  | 'native-busy'
  | 'native-timeout'
  | 'native-runtime'
  | 'native-quality'
  | 'ollama-unavailable'
  | 'ollama-quality'
```

### Phase state machine

Introduce a clearer phase model, for example:

```ts
type InferencePhase =
  | 'idle'
  | 'preparing-facts'
  | 'warming-classifier'
  | 'classifying'
  | 'validating-native-model'
  | 'loading-native-model'
  | 'generating-native'
  | 'correcting-native'
  | 'generating-ollama'
  | 'validating-summary'
  | 'using-deterministic-fallback'
  | 'completed'
  | 'cancelling'
  | 'failed'
```

### Diagnostics

Add local structured diagnostics without storing full names or prompts by default.

Safe fields include:

- provider
- phase
- attempt
- duration
- rejection code
- versions and digests
- whether the run downgraded

Production builds should not leave unconditional worker debug logging enabled.

## Test Plan

### Summary validator tests

Add table-driven tests for:

- wrong opening
- missing name
- missing known meaning
- missing literary reference
- invented meaning for unknown character
- repeated-character double explanation
- surname meaning leakage into given-name explanation
- unsupported personality or fate claim
- valid normalized summary acceptance

### Property and fuzz-style tests

Mutate accepted summaries by:

- inserting biography fragments
- deleting required meaning anchors
- adding province or dynasty markers
- injecting English, numbers, or list syntax
- perturbing boundary lengths

### Native Rust tests

Add tests for:

- model path change reload behavior
- same-size wrong-hash rejection
- validation-cache invalidation
- cancellation registration races
- duplicate request ID behavior
- inference-active reset after failure
- temporary download cleanup on interruption or hash mismatch
- lock contention and mirror fallback behavior

### Real worker integration tests

Beyond FakeWorker coverage, add browser-level tests that verify:

- actual worker bundle loading
- manifest and ONNX resolution from packaged assets
- WASM fallback behavior
- finite inference outputs
- label order integrity

### Build and CI plan

Add a unified verification command such as:

```bash
npm run verify
```

It should cover at minimum:

- data consistency checks
- full Vitest suite
- Python and TypeScript feature-contract tests
- real ONNX smoke test
- Rust fmt/check/test
- any new worker integration tests

This should run in normal CI, not only on release tags.

## Recommended Delivery Sequence

### Phase 1

Focus on high-risk correctness:

1. Introduce `GroundingFactPacket`.
2. Unify meaning normalization.
3. Replace summary validation with positive fact coverage plus typed rejection codes.
4. Stop corrective prompts from replaying full rejected hallucinated output.
5. Bind native model runtime to canonical path plus digest identity.
6. Move full GGUF validation to load boundary and cache the result.
7. Fix the current immediate-history AI persistence bug.

### Phase 2

Focus on controlled degradation and provenance:

1. Add unified inference deadline budget.
2. Implement typed failures and phase state machine.
3. Replace hard native failure behavior with safe deterministic downgrade rules.
4. Replace `loadedFromCache` and enrich result provenance.
5. Version history records and mark legacy entries.

### Phase 3

Focus on classifier trustworthiness:

1. Add ONNX artifact digest and label-order validation.
2. Implement confidence thresholds and abstention.
3. Build a reviewed evaluation set.
4. Add calibration-aware release metrics.
5. Add real worker integration tests.

### Phase 4

Focus on long-term governance:

1. Add structured diagnostics and regression dashboards.
2. Require provenance for reviewed meaning anchors.
3. Run full verification in PR CI.
4. Publish a repeatable reliability report before releases.

## Release Gates for Success

The hardening effort should be considered effective only if the following become true:

- known given-name meanings are preserved in accepted summaries
- unknown given-name characters never receive invented meanings
- biography, identity, and unsupported historical claims are rejected consistently
- the model verified on disk is the model actually used in memory
- ordinary analysis runs do not repeatedly hash the entire GGUF model
- generator failures still return safe deterministic output unless the user cancelled
- ONNX low-confidence cases can abstain rather than overclaim
- history entries record enough provenance to distinguish legacy output from current-policy output
- full verification runs before release through a normal reproducible CI path

## Implementation Note

Unless explicitly superseded, future implementation work for local AI reliability should follow this plan file as the default roadmap.
