// Win32: sessões de áudio, árvore de processos e captura por process loopback
// (Windows 10 2004+ / build 19041).

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use windows::core::{implement, Interface, Result, HRESULT, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eRender, ActivateAudioInterfaceAsync, AudioSessionStateExpired, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient,
    IAudioClient, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, DEVICE_STATE_ACTIVE, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, BLOB, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    CreateEventW, OpenProcess, QueryFullProcessImageNameW, SetEvent, WaitForSingleObject, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::Variant::VT_BLOB;
use windows_core::IUnknown;

use crate::mix::{Fifo, CHANNELS, SAMPLE_RATE};
use crate::plan::Session;

const ACTIVATE_TIMEOUT_MS: u32 = 5_000;
// Buffer pedido ao WASAPI, em unidades de 100 ns (20 ms).
const BUFFER_DURATION: i64 = 200_000;

pub fn com_init() {
    // S_FALSE (já iniciado) também serve.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

// PID → PID do pai, de todos os processos.
pub fn process_parents() -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return map };
        let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                map.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    map
}

fn process_image(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }
}

// Sessões de áudio (não expiradas) de todas as saídas ativas, uma por PID.
pub fn sessions() -> Result<Vec<Session>> {
    let mut out: Vec<Session> = Vec::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        for d in 0..devices.GetCount()? {
            let Ok(device) = devices.Item(d) else { continue };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
            let Ok(list) = manager.GetSessionEnumerator() else { continue };
            for i in 0..list.GetCount().unwrap_or(0) {
                let Ok(control) = list.GetSession(i) else { continue };
                if control.GetState().map_or(true, |s| s == AudioSessionStateExpired) {
                    continue;
                }
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                let Ok(pid) = control2.GetProcessId() else { continue };
                if pid == 0 || out.iter().any(|s| s.pid == pid) {
                    continue;
                }
                let Some(image) = process_image(pid) else { continue };
                let path = Path::new(&image);
                let file = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or(image.clone());
                let name = path.file_stem().map(|f| f.to_string_lossy().into_owned()).unwrap_or(file.clone());
                out.push(Session { pid, id: file.to_lowercase(), name });
            }
        }
    }
    Ok(out)
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler {
    done: HANDLE,
}

// O evento vive enquanto o handler: uma ativação que termina depois do timeout ainda
// sinaliza um handle válido (fechado só quando a última referência COM some).
impl Drop for ActivationHandler {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.done) };
    }
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(&self, _operation: windows_core::Ref<IActivateAudioInterfaceAsyncOperation>) -> Result<()> {
        unsafe { SetEvent(self.done) }
    }
}

// Ativa o cliente de captura da árvore de processos de `pid`.
unsafe fn activate_process_loopback(pid: u32) -> Result<IAudioClient> {
    let params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // ManuallyDrop: o Drop do PROPVARIANT chama PropVariantClear, que para VT_BLOB faz
    // CoTaskMemFree do pBlobData; aqui ele aponta para `params` na pilha, e liberar isso
    // corrompe o heap e derruba o helper logo depois de a captura ativar.
    let variant = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &params as *const _ as *mut u8,
                    },
                },
                ..Default::default()
            }),
        },
    });

    let done = CreateEventW(None, false, false, None)?;
    let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler { done }.into();
    let result = (|| {
        let operation = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*variant),
            &handler,
        )?;
        if WaitForSingleObject(done, ACTIVATE_TIMEOUT_MS) != WAIT_OBJECT_0 {
            return Err(windows::core::Error::from_hresult(HRESULT(0x8000_000Au32 as i32))); // E_PENDING
        }
        let mut hr = HRESULT(0);
        let mut interface: Option<IUnknown> = None;
        operation.GetActivateResult(&mut hr, &mut interface)?;
        hr.ok()?;
        interface.ok_or_else(windows::core::Error::empty)?.cast::<IAudioClient>()
    })();
    drop(handler);
    result
}

// Captura de um app em thread própria; para (e é liberada) ao sair do escopo.
pub struct Capture {
    stop: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Capture {
    pub fn start(pid: u32, fifo: Arc<Mutex<Fifo>>) -> std::result::Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel();
        let (thread_stop, thread_finished) = (stop.clone(), finished.clone());
        let thread = std::thread::spawn(move || {
            com_init();
            if let Err(err) = unsafe { run_capture(pid, &fifo, &thread_stop, &ready_tx) } {
                let _ = ready_tx.send(Err(format!("pid {pid}: {err}")));
            }
            thread_finished.store(true, Ordering::SeqCst);
        });
        let capture = Self { stop, finished, thread: Some(thread) };
        match ready_rx.recv_timeout(Duration::from_millis(ACTIVATE_TIMEOUT_MS as u64 + 1_000)) {
            Ok(Ok(())) => Ok(capture),
            Ok(Err(err)) => Err(err),
            Err(_) => Err(format!("pid {pid}: ativação sem resposta")),
        }
    }

    // A thread terminou sozinha (ex.: o processo fechou ou a saída de áudio mudou).
    pub fn finished(&self) -> bool {
        self.finished.load(Ordering::SeqCst)
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

unsafe fn run_capture(
    pid: u32,
    fifo: &Mutex<Fifo>,
    stop: &AtomicBool,
    ready: &mpsc::Sender<std::result::Result<(), String>>,
) -> Result<()> {
    let client = activate_process_loopback(pid)?;
    // O process loopback não informa formato (GetMixFormat falha): pedimos PCM 16 bits
    // e o WASAPI converte.
    let block_align = (CHANNELS * 2) as u16;
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: CHANNELS as u16,
        nSamplesPerSec: SAMPLE_RATE as u32,
        nAvgBytesPerSec: SAMPLE_RATE as u32 * block_align as u32,
        nBlockAlign: block_align,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK
            | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
            | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        BUFFER_DURATION,
        0,
        &format,
        None,
    )?;
    let event = CreateEventW(None, false, false, None)?;
    let result = (|| {
        client.SetEventHandle(event)?;
        let capture: IAudioCaptureClient = client.GetService()?;
        client.Start()?;
        let _ = ready.send(Ok(()));

        while !stop.load(Ordering::SeqCst) {
            WaitForSingleObject(event, 100);
            while capture.GetNextPacketSize()? > 0 {
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                let samples = frames as usize * CHANNELS;
                {
                    let mut fifo = fifo.lock().unwrap();
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                        fifo.push_silence(samples);
                    } else {
                        fifo.push_i16(std::slice::from_raw_parts(data as *const i16, samples));
                    }
                }
                capture.ReleaseBuffer(frames)?;
            }
        }
        let _ = client.Stop();
        Ok(())
    })();
    let _ = CloseHandle(event);
    result
}
