// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use fs2::FileExt;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
const MODEL_BASE_URLS: [&str; 2] = ["https://huggingface.co", "https://hf-mirror.com"];
const MODEL_INSTALL_FILENAME: &str = "qwen2.5-0.5b-instruct.gguf";

#[derive(Serialize, Deserialize)]
struct AppSettings {
    model_directory: PathBuf,
}

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

fn app_data_directory() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("Chinese Name Meaning Explorer");
    path
}

fn default_model_directory() -> PathBuf {
    let mut path = app_data_directory();
    path.push("models");
    path
}

fn settings_path() -> PathBuf {
    let mut path = app_data_directory();
    path.push("settings.json");
    path
}

fn configured_model_directory() -> PathBuf {
    let Ok(content) = fs::read_to_string(settings_path()) else {
        return default_model_directory();
    };
    let Ok(settings) = serde_json::from_str::<AppSettings>(&content) else {
        return default_model_directory();
    };
    if settings.model_directory.is_absolute() {
        settings.model_directory
    } else {
        default_model_directory()
    }
}

fn model_path(directory: &Path) -> PathBuf {
    directory.join(MODEL_INSTALL_FILENAME)
}

fn validate_model_directory(directory: &Path) -> Result<(), String> {
    if directory.is_absolute() {
        Ok(())
    } else {
        Err("模型下载目录必须是绝对路径".to_string())
    }
}

fn get_model_path() -> Result<PathBuf, String> {
    let directory = configured_model_directory();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create model directory: {error}"))?;
    let path = model_path(&directory);
    Ok(path)
}

fn save_model_directory(directory: PathBuf) -> Result<PathBuf, String> {
    validate_model_directory(&directory)?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建模型下载目录：{error}"))?;
    let settings_path = settings_path();
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建应用配置目录：{error}"))?;
    }
    let content = serde_json::to_vec_pretty(&AppSettings {
        model_directory: directory.clone(),
    })
    .map_err(|error| format!("无法保存模型目录配置：{error}"))?;
    let temp_path = settings_path.with_extension(format!("json.{}.tmp", std::process::id()));
    let mut temp_file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| format!("无法创建临时配置文件：{error}"))?;
    temp_file
        .write_all(&content)
        .and_then(|_| temp_file.sync_all())
        .map_err(|error| format!("无法写入模型目录配置：{error}"))?;
    drop(temp_file);
    replace_file(&temp_path, &settings_path)
        .map_err(|error| format!("无法保存模型目录配置：{error}"))?;
    Ok(directory)
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
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

async fn request_model(client: &reqwest::Client) -> Result<reqwest::Response, String> {
    let mut failures = Vec::new();
    for base_url in MODEL_BASE_URLS {
        let url = format!(
            "{base_url}/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/{MODEL_REVISION}/{MODEL_FILENAME}"
        );
        let response = match client.get(&url).send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response,
                Err(error) => {
                    failures.push(format!("{base_url}: {error}"));
                    continue;
                }
            },
            Err(error) => {
                failures.push(format!("{base_url}: {error}"));
                continue;
            }
        };
        match response.content_length() {
            Some(MODEL_SIZE) => return Ok(response),
            received => failures.push(format!(
                "{base_url}: unexpected model size (expected {MODEL_SIZE}, received {received:?})"
            )),
        }
    }
    Err(format!("所有模型下载源均不可用：{}", failures.join("; ")))
}

#[tauri::command]
async fn check_model_exists() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        get_model_path().is_ok_and(|path| model_is_valid(&path))
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
fn get_model_directory() -> String {
    configured_model_directory().to_string_lossy().to_string()
}

#[tauri::command]
fn set_model_directory(directory: String) -> Result<String, String> {
    let trimmed = directory.trim();
    if trimmed.is_empty() {
        return Err("模型下载目录不能为空".to_string());
    }
    save_model_directory(PathBuf::from(trimmed)).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
async fn download_model(handle: AppHandle) -> Result<String, String> {
    let path = get_model_path()?;
    let lock_path = path.clone();
    let _download_lock =
        tauri::async_runtime::spawn_blocking(move || acquire_download_lock(&lock_path))
            .await
            .map_err(|error| format!("Model download lock task failed: {error}"))??;
    if model_is_valid(&path) {
        return Ok(path.to_string_lossy().to_string());
    }
    if path.exists() {
        return Err(format!(
            "目标目录中已存在同名但未通过校验的文件：{}。为避免覆盖现有文件，请移走该文件或选择其他目录。",
            path.to_string_lossy()
        ));
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Failed to create model download client: {error}"))?;
    let res = request_model(&client).await?;
    let total_size = MODEL_SIZE;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = path.with_extension(format!("gguf.{nonce}.part"));
    let mut temporary = TemporaryDownload {
        path: temp_path.clone(),
        installed: false,
    };
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| format!("Failed to create temporary model file: {error}"))?;
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
        "<|im_start|>system\n你是姓名文字分析助手。只能依据用户提供的事实进行分析，不得调用或补充人物传记知识。<|im_end|>\n\
        <|im_start|>user\n姓名是“{}”。\n{}<|im_end|>\n\
        <|im_start|>assistant\n",
        name, context
    );

    let path = get_model_path()?;
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
            get_model_directory,
            set_model_directory,
            download_model,
            check_memory,
            generate_internal_summary,
            cancel_internal_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod model_directory_tests {
    use super::{model_path, validate_model_directory, MODEL_INSTALL_FILENAME};
    use std::path::Path;

    #[test]
    fn appends_the_fixed_model_filename() {
        assert_eq!(
            model_path(Path::new("D:\\ChineseNameModels")),
            Path::new("D:\\ChineseNameModels").join(MODEL_INSTALL_FILENAME)
        );
    }

    #[test]
    fn rejects_relative_model_directories() {
        assert_eq!(
            validate_model_directory(Path::new("models")),
            Err("模型下载目录必须是绝对路径".to_string())
        );
    }

    #[cfg(windows)]
    #[test]
    fn accepts_windows_drive_and_unc_directories() {
        assert!(validate_model_directory(Path::new("D:\\ChineseNameModels")).is_ok());
        assert!(validate_model_directory(Path::new("\\\\server\\models")).is_ok());
        assert!(validate_model_directory(Path::new("D:models")).is_err());
    }
}
