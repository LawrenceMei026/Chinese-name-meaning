# Chinese Name Meaning Explorer | 中文姓名解析计划

[English](#english) | [中文](#chinese)

---

<a name="english"></a>

## English

A Vue 3 application that analyzes Chinese names through character definitions, cultural context, and local AI analysis to provide a deep understanding of each character's meaning.

### Features

- **Hanzi-Specialized Analysis**: Optimized for 2-4 character Chinese names in the current `U+4E00-U+9FA5` validator range, with automatic surname/given-name segmentation.
- **Deep Dictionary Integration**: Powered by authoritative sources like Xinhua Dictionary, providing precise Simplified Chinese definitions.
- **Context-Aware Readings**: Applies single and compound surname pronunciations only after surname segmentation, including polyphonic surnames such as 乐, 翟, 华, and 覃.
- **Cultural Context**: Includes Five Elements, literary references, gender bias, and naming connotations.
- **Local AI Model (ONNX)**: Uses a custom-trained 10-label classifier (Scholarly, Heroic, Serene, etc.) with WebGPU hardware acceleration.
- **Layered Local Inference**: ONNX predicts the 10 tone labels. Tauri first tries a downloaded native Qwen2.5 GGUF; native unavailability or non-timeout failure permits Ollama, while a native timeout goes directly to deterministic text.
- **Controlled Inference Lifecycle**: Worker, Ollama, and native requests have bounded timeouts, cancellation, cleanup, and at most two attempts.
- **Privacy & History**: 100% local processing; history is stored in browser localStorage.
- **Open Feedback Loop**: Integrated GitHub feedback system with automated environment diagnostics.

### Tech Stack & Architecture

- **Frontend**: Vue 3 (Composition API)
- **Engine**: `localInference.ts` orchestrates an ONNX Runtime Web worker, native Tauri commands, local Ollama, and deterministic fallback.
- **Acceleration**: Prioritizes **WebGPU** with a stable WebAssembly fallback.
- **Desktop**: Packaged as a native Windows `.exe` via Tauri.
- **Native LLM**: Rust `llama-cpp-2` loads a Qwen2.5 0.5B Q4_K_M GGUF downloaded on demand to `%LOCALAPPDATA%\Chinese Name Meaning Explorer\models`.
- **Model Integrity**: The 491,400,032-byte download is pinned to a Hugging Face revision and verified by HTTP status, size, and SHA-256 before atomic installation.
- **Resilient Download**: The desktop downloader falls back to a mirror when the primary Hugging Face endpoint is unavailable without relaxing size or SHA-256 verification.

---

<a name="chinese"></a>

## 中文

一个基于 Vue 3 的中文姓名解析应用，通过汉字字义、文化背景及本地 AI 分析，深度解读每一个汉字背后的意义。

### 功能特性

- **汉字特化解析**：专门针对当前校验范围 `U+4E00-U+9FA5` 内的 2-4 位中文姓名进行优化，自动识别姓氏与名字。
- **深度字义解析**：整理自新华字典等权威来源，提供纯中文的精准释义。
- **姓氏语境读音**：完成姓氏切分后才应用单姓和复姓专用读音，正确处理乐、翟、华、覃等多音姓。
- **文化背景关联**：集成五行属性、典故出处、性别倾向及命名寓意。
- **本地 AI 模型 (ONNX)**：使用本地训练的 10 标签分类器（如书卷、豪迈、灵动等），通过 WebGPU 硬件加速进行“意境”实时分析。
- **分层本地推理**：ONNX 负责 10 类意境标签；Tauri 桌面端优先使用按需下载的 Qwen2.5 GGUF。原生不可用或非超时失败时尝试 Ollama；原生超时则直接回退到确定性文本。
- **可控推理生命周期**：Worker、Ollama 和原生推理均具备有界超时、取消、资源清理和最多两次尝试。
- **隐私与历史**：所有数据本地加载，历史记录存储于浏览器 localStorage，不上传任何隐私。
- **反馈闭环**：内置 GitHub 反馈入口，自动收集基础诊断信息。

### 技术架构

- **前端框架**：Vue 3 (Composition API)
- **推理引擎**：`localInference.ts` 统一调度 ONNX Worker、Tauri 原生命令、本地 Ollama 和确定性回退。
- **硬件加速**：优先尝试 **WebGPU**，稳健回退至 WebAssembly。
- **桌面支持**：通过 Tauri 提供 Windows `.exe` 原生包支持。
- **原生大模型**：Rust `llama-cpp-2` 加载 Qwen2.5 0.5B Q4_K_M GGUF，模型按需下载到 `%LOCALAPPDATA%\Chinese Name Meaning Explorer\models`。
- **模型完整性**：491,400,032 字节的下载固定到 Hugging Face revision，并在原子安装前校验 HTTP 状态、大小和 SHA-256。
- **下载容错**：官方 Hugging Face 端点不可用时自动切换镜像，同时保持大小和 SHA-256 完整性校验不变。

---

## Project Structure | 项目结构

```text
my-vue-app/
  public/
    data/
      chars.json      # Chinese-first dictionary (Xinhua core data)
      surnames.json   # Single-character surname-specific readings
    models/
      classifier.onnx # Custom-trained 16-dim feature -> 10-class classifier
      manifest.json   # Model version and label mapping
  src/
    App.vue           # Core UI logic
    services/
      localInference.ts       # AI Orchestration
      nameAnalyzer.ts         # Dict & Segmentation engine
    data/
      compoundSurnamePinyin.json # Contextual readings that cannot be inferred safely
    workers/
      localInference.worker.ts # ONNX Inference worker
  src-tauri/
    src/main.rs                # Secure model download and Tauri commands
    src/native_llm.rs          # llama.cpp-backed GGUF generation
```

## ML Context | 本地训练与模型

If you wish to retrain the model, use `my-vue-app/train_model.py` (requires torch/onnx):
- **Labels**: Scholarly, Grand, Heroic, Serene, Classical, Unique, Dynamic, Persistent, Nature, Deep.
- **Feature Engineering**: 16-dimensional hybrid vector including 4 semantic category scores.

如需重新训练模型，请使用 `my-vue-app/train_model.py`：
- **标签体系**：书卷、宏伟、豪迈、恬静、典雅、新颖、灵动、坚毅、自然、深邃。
- **特征工程**：16 维混合向量，注入了 4 类语义词谱得分。

## Development | 开发指南

```bash
cd my-vue-app
npm ci
npm run dev
```

## Windows Packaging | 打包发布

1. Install locked dependencies in `my-vue-app`: `npm ci`.
2. Ensure Rust stable, MSVC, Visual Studio C++ build tools, CMake, and LLVM/libclang are installed on Windows.
3. Run `npm run tauri:build`.
4. Output: `my-vue-app/src-tauri/target/release/bundle/`.

The installer contains the downloader, not the GGUF weights. On first desktop launch, users may download approximately 491 MB. When the model is missing, the download dialog warns systems reporting less than 6GB RAM; it does not block download or later native inference.

## Verification | 验证步骤

```bash
cd my-vue-app
npm audit --omit=dev
npm audit
npm run test:features
npm run test:unit -- --run
npm run type-check
npm run lint:check
npm run test:onnx
npm run build
cd src-tauri
cargo fmt --check
cargo check --locked
cargo test --locked
```

`test:onnx` creates an ONNX Runtime Web WASM session, executes `public/models/classifier.onnx` with a real tensor, and validates the output contract and finite values. `lint:check` is read-only and scans only project-owned source, scripts, and configuration; generated ONNX Runtime files under `public/` are excluded.

The tag-triggered Windows workflow runs version validation, feature tests, unit tests, TypeScript checking, read-only lint, the real ONNX smoke test, and locked Rust checks before `tauri-apps/tauri-action@v0` can package a release. The committed npm dependency graph currently reports zero vulnerabilities through both `npm audit --omit=dev` and `npm audit`.

## Data Sources & License | 数据来源与证书

- Dictionary data: CC-CEDICT & Xinhua Dictionary.
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
