// screenshare-audio: áudio do sistema no Windows, filtrado por app.
//
//   screenshare-audio sessions --own-pid <pid>
//     Imprime {"apps":[{"id","name"}]} com os apps que têm sessão de áudio.
//   screenshare-audio capture --own-pid <pid>
//     Escreve no stdout Float32 LE estéreo intercalado a 48 kHz, em blocos de 10 ms,
//     com a mistura de todos os apps exceto o próprio ScreenShare e os bloqueados.
//     `--blocked '["discord.exe"]'` define a lista inicial (vale desde a primeira captura);
//     cada linha do stdin é {"blocked":["discord.exe", ...]} e substitui a lista;
//     o fim do stdin (app fechado) encerra o processo.

mod mix;
mod plan;
#[cfg(windows)]
mod win;

#[cfg(not(windows))]
fn main() {
    eprintln!("screenshare-audio só funciona no Windows");
    std::process::exit(2);
}

#[cfg(windows)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let own_pid = args
        .iter()
        .position(|a| a == "--own-pid")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    win::com_init();
    let code = match args.get(1).map(String::as_str) {
        Some("sessions") => run::sessions(own_pid),
        Some("capture") => {
            let blocked = args
                .iter()
                .position(|a| a == "--blocked")
                .and_then(|i| args.get(i + 1))
                .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
                .unwrap_or_default();
            run::capture(own_pid, blocked)
        }
        _ => {
            eprintln!("uso: screenshare-audio <sessions|capture> --own-pid <pid>");
            2
        }
    };
    std::process::exit(code);
}

#[cfg(windows)]
mod run {
    use std::collections::{BTreeMap, HashSet};
    use std::io::{BufRead, Write};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};

    use crate::mix::{clamp, Fifo, BLOCK_SAMPLES};
    use crate::plan::{list_apps, plan_captures};
    use crate::win::{self, Capture};

    const RESCAN_INTERVAL: Duration = Duration::from_secs(1);
    const BLOCK_DURATION: Duration = Duration::from_millis(10);
    // Atrasado mais que isto (máquina travou), o relógio do mixer recomeça do agora.
    const MAX_LAG: Duration = Duration::from_millis(100);

    pub fn sessions(own_pid: u32) -> i32 {
        match win::sessions() {
            Ok(sessions) => {
                let apps = list_apps(&sessions, &win::process_parents(), own_pid);
                println!("{}", serde_json::json!({ "apps": apps }));
                0
            }
            Err(err) => {
                eprintln!("falha ao listar sessões: {err}");
                1
            }
        }
    }

    #[derive(serde::Deserialize)]
    struct Command {
        blocked: Vec<String>,
    }

    type Sources = Arc<Mutex<Vec<Arc<Mutex<Fifo>>>>>;

    pub fn capture(own_pid: u32, initial: Vec<String>) -> i32 {
        let initial = initial.into_iter().map(|id| id.to_lowercase()).collect();
        let blocked: Arc<Mutex<(HashSet<String>, bool)>> = Arc::new(Mutex::new((initial, true)));
        let sources: Sources = Arc::new(Mutex::new(Vec::new()));

        let commands = blocked.clone();
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                match serde_json::from_str::<Command>(&line) {
                    Ok(cmd) => {
                        let mut state = commands.lock().unwrap();
                        state.0 = cmd.blocked.into_iter().map(|id| id.to_lowercase()).collect();
                        state.1 = true;
                    }
                    Err(err) => eprintln!("comando inválido: {err}"),
                }
            }
            // O app fechou o pipe: não pode sobrar helper capturando áudio.
            std::process::exit(0);
        });

        let supervised = sources.clone();
        std::thread::spawn(move || supervise(own_pid, &blocked, &supervised));

        unsafe { timeBeginPeriod(1) };
        let code = mix_loop(&sources);
        unsafe { timeEndPeriod(1) };
        code
    }

    // Mantém uma captura por processo do plano, reavaliando a cada segundo ou
    // quando a lista de bloqueados muda.
    fn supervise(own_pid: u32, blocked: &Mutex<(HashSet<String>, bool)>, sources: &Sources) {
        win::com_init();
        let mut running: BTreeMap<u32, (Capture, Arc<Mutex<Fifo>>)> = BTreeMap::new();
        let mut last_scan: Option<Instant> = None;
        loop {
            let (blocked_now, changed) = {
                let mut state = blocked.lock().unwrap();
                let changed = std::mem::replace(&mut state.1, false);
                (state.0.clone(), changed)
            };
            if changed || last_scan.is_none_or(|t| t.elapsed() >= RESCAN_INTERVAL) {
                last_scan = Some(Instant::now());
                let sessions = win::sessions().unwrap_or_else(|err| {
                    eprintln!("falha ao listar sessões: {err}");
                    Vec::new()
                });
                let plan = plan_captures(&sessions, &win::process_parents(), own_pid, &blocked_now);

                running.retain(|pid, (capture, _)| plan.contains(pid) && !capture.finished());
                // Publica a remoção antes de abrir capturas novas (que podem demorar).
                publish(sources, &running);
                for pid in plan {
                    // Lista mudou durante ativações lentas: replaneja já, sem abrir o resto.
                    if blocked.lock().unwrap().1 {
                        break;
                    }
                    if running.contains_key(&pid) {
                        continue;
                    }
                    let fifo = Arc::new(Mutex::new(Fifo::default()));
                    match Capture::start(pid, fifo.clone()) {
                        Ok(capture) => {
                            running.insert(pid, (capture, fifo));
                            publish(sources, &running);
                        }
                        Err(err) => eprintln!("falha ao capturar {err}"),
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn publish(sources: &Sources, running: &BTreeMap<u32, (Capture, Arc<Mutex<Fifo>>)>) {
        *sources.lock().unwrap() = running.values().map(|(_, fifo)| fifo.clone()).collect();
    }

    // Relógio fixo de 10 ms: sempre escreve um bloco (silêncio se ninguém toca),
    // para o app saber que o helper está vivo e manter o fluxo contínuo.
    fn mix_loop(sources: &Sources) -> i32 {
        // Direto no handle: o Stdout do Rust é LineWriter e partiria os blocos de PCM
        // em qualquer byte 0x0A (duas escritas por bloco).
        let mut stdout = {
            use std::os::windows::io::{AsRawHandle, FromRawHandle};
            std::mem::ManuallyDrop::new(unsafe {
                std::fs::File::from_raw_handle(std::io::stdout().as_raw_handle())
            })
        };
        let mut block = vec![0f32; BLOCK_SAMPLES];
        let mut bytes = Vec::with_capacity(BLOCK_SAMPLES * 4);
        let mut next = Instant::now();
        loop {
            block.fill(0.0);
            let current: Vec<_> = sources.lock().unwrap().clone();
            for fifo in current {
                fifo.lock().unwrap().mix_into(&mut block);
            }
            clamp(&mut block);
            bytes.clear();
            for s in &block {
                bytes.extend_from_slice(&s.to_le_bytes());
            }
            if stdout.write_all(&bytes).is_err() {
                return 0;
            }

            next += BLOCK_DURATION;
            let now = Instant::now();
            if now > next + MAX_LAG {
                next = now;
            } else if next > now {
                std::thread::sleep(next - now);
            }
        }
    }
}
