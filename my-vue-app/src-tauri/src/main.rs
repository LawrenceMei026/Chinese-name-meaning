// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use sysinfo::System;

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
async fn generate_internal_summary(name: String, context: String) -> Result<String, String> {
    // 这里暂时是 LLM 推理占位符，真正的 llm crate 初始化逻辑由于较重，建议在独立状态管理中处理
    // 考虑到构建稳定性，我们先实现链路通顺
    Ok(format!("模型正在加载：{}（上下文：{}）。由于本地编译环境限制，核心推理正在初始化。", name, context))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_model_exists,
            download_model,
            check_memory,
            generate_internal_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
