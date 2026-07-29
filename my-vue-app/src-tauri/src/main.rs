// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use fs2::FileExt;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, State};

mod native_llm;
use native_llm::LlamaRuntime;

struct AppState {
    runtime: Mutex<LlamaRuntime>,
    cancellations: Mutex<HashMap<String, Option<Arc<AtomicBool>>>>,
    inference_active: AtomicBool,
}

const MAX_PENDING_CANCELLATIONS: usize = 64;
const MODEL_REVISION: &str = "9217f5db79a29953eb74d5343926648285ec7e67";
const MODEL_FILENAME: &str = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
const MODEL_SIZE: u64 = 491_400_032;
const MODEL_SHA256: &str = "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db";

#[derive(Serialize, Deserialize, Clone)]
struct DownloadPayload {
    progress: f64,
    total_size: u64,
    downloaded: u64,
}

struct TemporaryDownload {
    path: PathBuf,
    installed: bool,
}

impl Drop for TemporaryDownload {
    fn drop(&mut self) {
        if !self.installed {
            let _ = fs::remove_file(&self.path);
        }
    }
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

fn model_is_valid(path: &PathBuf) -> bool {
    if !matches!(fs::metadata(path), Ok(metadata) if metadata.len() == MODEL_SIZE) {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => hasher.update(&buffer[..read]),
            Err(_) => return false,
        }
    }
    format!("{:x}", hasher.finalize()) == MODEL_SHA256
}

fn acquire_download_lock(path: &PathBuf) -> Result<fs::File, String> {
    let lock_path = path.with_extension("gguf.lock");
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|error| format!("Failed to open model download lock: {error}"))?;
    lock.lock_exclusive()
        .map_err(|error| format!("Failed to acquire model download lock: {error}"))?;
    Ok(lock)
}

#[tauri::command]
async fn check_model_exists() -> bool {
    tauri::async_runtime::spawn_blocking(|| model_is_valid(&get_model_path()))
        .await
        .unwrap_or(false)
}

#[tauri::command]
async fn download_model(handle: AppHandle) -> Result<String, String> {
    let path = get_model_path();
    let lock_path = path.clone();
    let _download_lock =
        tauri::async_runtime::spawn_blocking(move || acquire_download_lock(&lock_path))
            .await
            .map_err(|error| format!("Model download lock task failed: {error}"))??;
    if model_is_valid(&path) {
        return Ok(path.to_string_lossy().to_string());
    }
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Failed to remove invalid model before download: {error}"))?;
    }
    let url = format!(
        "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/{MODEL_REVISION}/{MODEL_FILENAME}"
    );
    let client = reqwest::Client::new();
    let res = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?;

    let total_size = res.content_length().ok_or("Failed to get content length")?;
    if total_size != MODEL_SIZE {
        return Err(format!(
            "Unexpected model size: expected {MODEL_SIZE}, received {total_size}"
        ));
    }
    let temp_path = path.with_extension("gguf.part");
    let mut temporary = TemporaryDownload {
        path: temp_path.clone(),
        installed: false,
    };
    let mut file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = match item {
            Ok(chunk) => chunk,
            Err(error) => {
                return Err(error.to_string());
            }
        };
        if let Err(error) = file.write_all(&chunk) {
            return Err(error.to_string());
        }
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        let progress = (downloaded as f64 / total_size as f64) * 100.0;
        handle
            .emit(
                "download-progress",
                DownloadPayload {
                    progress,
                    total_size,
                    downloaded,
                },
            )
            .unwrap_or(());
    }

    if let Err(error) = file.sync_all() {
        return Err(error.to_string());
    }
    drop(file);
    let digest = format!("{:x}", hasher.finalize());
    if downloaded != MODEL_SIZE || digest != MODEL_SHA256 {
        return Err(format!(
            "Model integrity check failed: size={downloaded}, sha256={digest}"
        ));
    }
    if let Err(error) = fs::rename(&temp_path, &path) {
        return Err(format!(
            "Failed to install validated model atomically: {error}"
        ));
    }
    temporary.installed = true;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn check_memory() -> Result<u64, String> {
    let mut sys = System::new_all();
    sys.refresh_memory();
    Ok(sys.total_memory() / 1024 / 1024 / 1024) // 返回 GB
}

#[tauri::command]
fn cancel_internal_summary(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    let mut cancellations = state
        .cancellations
        .lock()
        .map_err(|_| "Failed to lock cancellation state")?;
    if let Some(Some(cancelled)) = cancellations.get(&request_id) {
        cancelled.store(true, Ordering::Release);
    } else if !cancellations.contains_key(&request_id) {
        if cancellations
            .values()
            .filter(|entry| entry.is_none())
            .count()
            >= MAX_PENDING_CANCELLATIONS
        {
            if let Some(stale_id) = cancellations
                .iter()
                .find_map(|(id, entry)| entry.is_none().then(|| id.clone()))
            {
                cancellations.remove(&stale_id);
            }
        }
        cancellations.insert(request_id, None);
    }
    Ok(())
}

fn register_inference(
    state: &AppState,
    request_id: &str,
    cancelled: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut cancellations = state
        .cancellations
        .lock()
        .map_err(|_| "Failed to lock cancellation state")?;
    match cancellations.get(request_id) {
        Some(None) => {
            cancellations.remove(request_id);
            Err("Inference cancelled".to_string())
        }
        Some(Some(_)) => Err("Duplicate inference request ID".to_string()),
        None => {
            cancellations.insert(request_id.to_string(), Some(Arc::clone(cancelled)));
            Ok(())
        }
    }
}

#[tauri::command]
async fn generate_internal_summary(
    handle: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    name: String,
    context: String,
) -> Result<String, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    register_inference(state.inner(), &request_id, &cancelled)?;
    if state
        .inference_active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        if let Ok(mut cancellations) = state.cancellations.lock() {
            cancellations.remove(&request_id);
        }
        return Err("Native inference is already running".to_string());
    }

    let cancelled_for_task = Arc::clone(&cancelled);
    let task_result = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        generate_summary(state.inner(), &cancelled_for_task, name, context)
    })
    .await;
    state.inference_active.store(false, Ordering::Release);
    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&request_id);
    }
    match task_result {
        Ok(result) => result,
        Err(error) => Err(format!("Inference task failed: {error}")),
    }
}

fn generate_summary(
    state: &AppState,
    cancelled: &Arc<AtomicBool>,
    name: String,
    context: String,
) -> Result<String, String> {
    if cancelled.load(Ordering::Acquire) {
        return Err("Inference cancelled".to_string());
    }
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "Failed to lock model state")?;
    if cancelled.load(Ordering::Acquire) {
        return Err("Inference cancelled".to_string());
    }

    let prompt = format!(
        "<|im_start|>system\n你是一个精通中国传统文化、文学和取名艺术的专家。<|im_end|>\n\
        <|im_start|>user\n名字是“{}”。相关背景：{}。请结合具体字义生成一段100字左右的文雅姓名意境分析。只输出分析内容。<|im_end|>\n\
        <|im_start|>assistant\n",
        name, context
    );

    let path = get_model_path();
    if !matches!(fs::metadata(&path), Ok(metadata) if metadata.len() == MODEL_SIZE) {
        return Err("Model file is missing or has an unexpected size".to_string());
    }
    runtime.generate(&path, &prompt, cancelled, 200)
}

fn main() {
    let runtime = LlamaRuntime::new().expect("failed to initialize llama.cpp backend");
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            runtime: Mutex::new(runtime),
            cancellations: Mutex::new(HashMap::new()),
            inference_active: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            check_model_exists,
            download_model,
            check_memory,
            generate_internal_summary,
            cancel_internal_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
