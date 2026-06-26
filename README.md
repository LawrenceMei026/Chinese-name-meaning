# Chinese Name Meaning Explorer | 中文姓名解析计划

[English](#english) | [中文](#chinese)

---

<a name="english"></a>

## English

A Vue 3 application that analyzes Chinese names through character definitions, cultural context, and local AI analysis to provide a deep understanding of each character's meaning.

### Features

- **Hanzi-Specialized Analysis**: Optimized for 2-4 character Chinese names with automatic surname/given-name segmentation.
- **Deep Dictionary Integration**: Powered by authoritative sources like Xinhua Dictionary, providing precise Simplified Chinese definitions.
- **Cultural Context**: Includes Five Elements, literary references, gender bias, and naming connotations.
- **Local AI Model (ONNX)**: Uses a custom-trained 10-label classifier (Scholarly, Heroic, Serene, etc.) with WebGPU hardware acceleration.
- **Dynamic Narrative Engine**: AI synthesizes character meanings with predicted "vibes" to generate human-like summaries.
- **Privacy & History**: 100% local processing; history is stored in browser localStorage.
- **Open Feedback Loop**: Integrated GitHub feedback system with automated environment diagnostics.

### Tech Stack & Architecture

- **Frontend**: Vue 3 (Composition API)
- **Engine**: `localInference.ts` orchestrates an ONNX Runtime Web worker.
- **Acceleration**: Prioritizes **WebGPU** with a stable WebAssembly fallback.
- **Desktop**: Packaged as a native Windows `.exe` via Tauri.

---

<a name="chinese"></a>

## 中文

一个基于 Vue 3 的中文姓名解析应用，通过汉字字义、文化背景及本地 AI 分析，深度解读每一个汉字背后的意义。

### 功能特性

- **汉字特化解析**：专门针对 2-4 位中文姓名进行优化，自动识别姓氏与名字。
- **深度字义解析**：整理自新华字典等权威来源，提供纯中文的精准释义。
- **文化背景关联**：集成五行属性、典故出处、性别倾向及命名寓意。
- **本地 AI 模型 (ONNX)**：使用本地训练的 10 标签分类器（如书卷、豪迈、灵动等），通过 WebGPU 硬件加速进行“意境”实时分析。
- **动态叙事引擎**：AI 结合字义与风格预测，生成人性化的中文姓名总结。
- **隐私与历史**：所有数据本地加载，历史记录存储于浏览器 localStorage，不上传任何隐私。
- **反馈闭环**：内置 GitHub 反馈入口，自动收集基础诊断信息。

### 技术架构

- **前端框架**：Vue 3 (Composition API)
- **推理引擎**：`localInference.ts` 调度 Web Worker 运行 `classifier.onnx`。
- **硬件加速**：优先尝试 **WebGPU**，稳健回退至 WebAssembly。
- **桌面支持**：通过 Tauri 提供 Windows `.exe` 原生包支持。

---

## Project Structure | 项目结构

```text
my-vue-app/
  public/
    data/
      chars.json      # Chinese-first dictionary (Xinhua core data)
      surnames.json   # Surname database
    models/
      classifier.onnx # Custom-trained 16-dim feature -> 10-class classifier
      manifest.json   # Model version and label mapping
  src/
    App.vue           # Core UI logic
    services/
      localInference.ts       # AI Orchestration
      nameAnalyzer.ts         # Dict & Segmentation engine
    workers/
      localInference.worker.ts # ONNX Inference worker
```

## ML Context | 本地训练与模型

If you wish to retrain the model, use `train_model.py` in the root (requires torch/onnx):
- **Labels**: Scholarly, Grand, Heroic, Serene, Classical, Unique, Dynamic, Persistent, Nature, Deep.
- **Feature Engineering**: 16-dimensional hybrid vector including 4 semantic category scores.

如需重新训练模型，根目录下包含 `train_model.py`：
- **标签体系**：书卷、宏伟、豪迈、恬静、典雅、新颖、灵动、坚毅、自然、深邃。
- **特征工程**：16 维混合向量，注入了 4 类语义词谱得分。

## Development | 开发指南

```bash
cd my-vue-app
npm install
npm run dev
```

## Windows Packaging | 打包发布

1. Install deps in `my-vue-app`: `npm install`.
2. Ensure Rust & MSVC toolchains are installed on Windows.
3. Run `npm run tauri:build`.
4. Output: `my-vue-app/src-tauri/target/release/bundle/`.

## Verification | 验证步骤

```bash
cd my-vue-app
npm run test:unit
npm run type-check
npm run build
```

## Data Sources & License | 数据来源与证书

- Dictionary data: CC-CEDICT & Xinhua Dictionary.
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
