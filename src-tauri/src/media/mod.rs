//! Captura nativa de tela e áudio (DXGI/WASAPI no Windows, PipeWire no Linux).
//! Implementação real virá na Fase 3; por ora expõe só a detecção de plataforma.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: &'static str,
    pub arch: &'static str,
    pub capture_backend: &'static str,
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    let capture_backend = if cfg!(target_os = "windows") {
        "dxgi-wasapi"
    } else if cfg!(target_os = "linux") {
        "pipewire"
    } else {
        "unsupported"
    };

    PlatformInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        capture_backend,
    }
}
