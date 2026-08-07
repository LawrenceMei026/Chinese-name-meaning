use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct LlamaRuntime {
    backend: LlamaBackend,
    model: Option<LlamaModel>,
    loaded_path: Option<PathBuf>,
}

impl LlamaRuntime {
    pub fn new() -> Result<Self, String> {
        let backend = LlamaBackend::init()
            .map_err(|error| format!("Failed to initialize llama.cpp: {error}"))?;
        Ok(Self {
            backend,
            model: None,
            loaded_path: None,
        })
    }

    pub fn generate(
        &mut self,
        model_path: &Path,
        prompt: &str,
        cancelled: &AtomicBool,
        max_tokens: usize,
        seed: u32,
    ) -> Result<String, String> {
        if cancelled.load(Ordering::Acquire) {
            return Err("Inference cancelled".to_string());
        }
        if self.loaded_path.as_deref() != Some(model_path) {
            self.model = None;
            self.loaded_path = None;
        }
        if self.model.is_none() {
            let model =
                LlamaModel::load_from_file(&self.backend, model_path, &LlamaModelParams::default())
                    .map_err(|error| format!("Failed to load GGUF model: {error}"))?;
            self.model = Some(model);
            self.loaded_path = Some(model_path.to_path_buf());
        }
        if cancelled.load(Ordering::Acquire) {
            return Err("Inference cancelled".to_string());
        }

        let model = self.model.as_ref().ok_or("Model not loaded")?;
        let context_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(2048))
            .with_n_threads(4)
            .with_n_threads_batch(4);
        let mut context = model
            .new_context(&self.backend, context_params)
            .map_err(|error| format!("Failed to create inference context: {error}"))?;
        let prompt_tokens = model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|error| format!("Failed to tokenize prompt: {error}"))?;
        if prompt_tokens.is_empty() {
            return Err("Prompt produced no tokens".to_string());
        }
        if prompt_tokens.len() + max_tokens > context.n_ctx() as usize {
            return Err("Prompt exceeds model context window".to_string());
        }

        let mut batch = LlamaBatch::new(prompt_tokens.len(), 1);
        batch
            .add_sequence(&prompt_tokens, 0, false)
            .map_err(|error| format!("Failed to prepare prompt: {error}"))?;
        context
            .decode(&mut batch)
            .map_err(|error| format!("Failed to evaluate prompt: {error}"))?;

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),
            LlamaSampler::temp(0.7),
            LlamaSampler::dist(seed),
        ]);
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut response = String::new();
        for position in (batch.n_tokens()..).take(max_tokens) {
            if cancelled.load(Ordering::Acquire) {
                return Err("Inference cancelled".to_string());
            }
            let token = sampler.sample(&context, batch.n_tokens() - 1);
            sampler.accept(token);
            if model.is_eog_token(token) {
                break;
            }
            response.push_str(
                &model
                    .token_to_piece(token, &mut decoder, true, None)
                    .map_err(|error| format!("Failed to decode token: {error}"))?,
            );
            batch.clear();
            batch
                .add(token, position, &[0], true)
                .map_err(|error| format!("Failed to prepare generated token: {error}"))?;
            context
                .decode(&mut batch)
                .map_err(|error| format!("Failed to evaluate generated token: {error}"))?;
        }

        if cancelled.load(Ordering::Acquire) {
            return Err("Inference cancelled".to_string());
        }
        Ok(response.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::LlamaRuntime;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn cancellation_prevents_model_loading() {
        let mut runtime = LlamaRuntime::new().expect("runtime should initialize");
        assert!(runtime.loaded_path.is_none());

        let result = runtime.generate(
            Path::new("missing.gguf"),
            "unused prompt",
            &AtomicBool::new(true),
            1,
            20260728,
        );

        assert_eq!(result, Err("Inference cancelled".to_string()));
    }
}
