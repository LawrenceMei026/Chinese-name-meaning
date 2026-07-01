// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, State};
use sysinfo::System;
use llm::Model;

struct AppState {
    model: Mutex<Option<Box<dyn llm::Model>>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct DownloadPayload {
    progress: f64,
    total_size: u64,
    downloaded: u64,
}

fn get_model_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("Chinese Name Meaning Explorer");
    path.push("models");
    if !path.exists() {
        fs::create_dir_all(&path).expect("Failed to create model directory");
    }
    path.push("qwen2.5-0.5b-instruct.gguf");
    path
}

#[tauri::command]
async fn check_model_exists() -> bool {
    get_model_path().exists()
}

#[tauri::command]
async fn download_model(handle: AppHandle) -> Result<String, String> {
    // 这是一个示例链接，之后应替换为 GitHub Release 的真实链接
    let url = "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf";
    let client = reqwest::Client::new();
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;

    let total_size = res.content_length().ok_or("Failed to get content length")?;
    let path = get_model_path();
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let progress = (downloaded as f64 / total_size as f64) * 100.0;
        handle.emit("download-progress", DownloadPayload {
            progress,
            total_size,
            downloaded,
        }).unwrap_or(());
    }

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn check_memory() -> Result<u64, String> {
    let mut sys = System::new_all();
    sys.refresh_memory();
    Ok(sys.total_memory() / 1024 / 1024 / 1024) // 返回 GB
}

#[tauri::command]
async fn generate_internal_summary(
    state: State<'_, AppState>,
    name: String,
    context: String
) -> Result<String, String> {
    let mut model_guard = state.model.lock().map_err(|_| "Failed to lock model state")?;

    // 如果模型还没加载，则进行加载
    if model_guard.is_none() {
        let path = get_model_path();
        if !path.exists() {
            return Err("Model file not found. Please download it first.".to_string());
        }

        let model = llm::load_dynamic(
            Some(llm::ModelArchitecture::Llama), // Qwen2.5 通常兼容 Llama 架构
            &path,
            llm::TokenizerSource::Embedded,
            Default::default(),
            llm::load_progress_callback_stdout,
        )
        .map_err(|e| format!("Failed to load model: {}", e))?;

        *model_guard = Some(model);
    }

    let model = model_guard.as_ref().ok_or("Model not loaded")?;
    let mut session = model.start_session(Default::default());

    let prompt = format!(
        "<|im_start|>system\n你是一个精通中国传统文化、文学和取名艺术的专家。<|im_end|>\n\
        <|im_start|>user\n名字是“{}”。相关背景：{}。请结合具体字义生成一段100字左右的文雅姓名意境分析。只输出分析内容。<|im_end|>\n\
        <|im_start|>assistant\n",
        name, context
    );

    let mut response = String::new();
    session.infer::<std::convert::Infallible>(
        model.as_ref(),
        &mut rand::thread_rng(),
        &llm::InferenceRequest {
            prompt: llm::Prompt::Text(&prompt),
            parameters: &llm::InferenceParameters::default(),
            play_back_previous_tokens: false,
            maximum_token_count: Some(200),
        },
        &mut Default::default(),
        |t| {
            if let llm::InferenceResponse::SnapshotToken(token) = t {
                response.push_str(&token);
            }
            Ok(llm::InferenceFeedback::Continue)
        }
    ).map_err(|e| format!("Inference failed: {}", e))?;

    Ok(response.trim().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            model: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_model_exists,
            download_model,
            check_memory,
            generate_internal_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
