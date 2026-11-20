// Decide quais processos capturar com o process loopback do Windows.
//
// A API só captura árvores de processos inteiras (o alvo e todos os descendentes),
// então incluir um processo cujo descendente está bloqueado (ou é o próprio
// ScreenShare) vazaria esse áudio. Nesses casos o ancestral fica de fora e só os
// descendentes permitidos são capturados, cada um com a sua árvore.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

// Uma sessão de áudio de reprodução: o processo e o id do app (executável em minúsculas).
#[derive(Clone, Debug)]
pub struct Session {
    pub pid: u32,
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct App {
    pub id: String,
    pub name: String,
}

// Limite contra ciclos no mapa de pais (PIDs reaproveitados pelo sistema).
const MAX_DEPTH: usize = 64;

fn ancestors(pid: u32, parents: &HashMap<u32, u32>) -> Vec<u32> {
    let mut out = Vec::new();
    let mut current = pid;
    while out.len() < MAX_DEPTH {
        match parents.get(&current) {
            Some(&parent) if parent != 0 && parent != current && !out.contains(&parent) => {
                out.push(parent);
                current = parent;
            }
            _ => break,
        }
    }
    out
}

fn is_own(pid: u32, own_pid: u32, parents: &HashMap<u32, u32>) -> bool {
    pid == own_pid || ancestors(pid, parents).contains(&own_pid)
}

// Apps que tocam áudio, exceto o próprio ScreenShare e os sons do sistema (PID 0).
pub fn list_apps(sessions: &[Session], parents: &HashMap<u32, u32>, own_pid: u32) -> Vec<App> {
    let mut apps = BTreeMap::new();
    for s in sessions {
        if s.pid == 0 || is_own(s.pid, own_pid, parents) {
            continue;
        }
        apps.entry(s.id.clone()).or_insert_with(|| App { id: s.id.clone(), name: s.name.clone() });
    }
    let mut list: Vec<App> = apps.into_values().collect();
    list.sort_by_key(|a| a.name.to_lowercase());
    list
}

// PIDs cujas árvores devem ser capturadas.
pub fn plan_captures(
    sessions: &[Session],
    parents: &HashMap<u32, u32>,
    own_pid: u32,
    blocked: &HashSet<String>,
) -> BTreeSet<u32> {
    let mut excluded: BTreeSet<u32> = BTreeSet::from([own_pid]);
    let mut candidates = BTreeSet::new();
    for s in sessions.iter().filter(|s| s.pid != 0) {
        if is_own(s.pid, own_pid, parents) || blocked.contains(&s.id) {
            excluded.insert(s.pid);
        } else {
            candidates.insert(s.pid);
        }
    }
    // Um bloqueado que também tem sessão de outro app no mesmo PID continua bloqueado.
    candidates.retain(|pid| !excluded.contains(pid));

    // A árvore do candidato não pode conter nenhum processo excluído.
    let excluded_ancestors: HashSet<u32> =
        excluded.iter().flat_map(|&pid| ancestors(pid, parents)).collect();
    let safe: BTreeSet<u32> =
        candidates.into_iter().filter(|pid| !excluded_ancestors.contains(pid)).collect();

    // Quem já está na árvore de outro capturado seria contado duas vezes.
    safe.iter()
        .copied()
        .filter(|&pid| !ancestors(pid, parents).iter().any(|a| safe.contains(a)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(pid: u32, id: &str) -> Session {
        Session { pid, id: id.into(), name: id.trim_end_matches(".exe").into() }
    }

    const OWN: u32 = 100;

    fn parents(pairs: &[(u32, u32)]) -> HashMap<u32, u32> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn captura_todos_os_apps_menos_o_proprio() {
        // 101 é o serviço de áudio do Chromium dentro do ScreenShare.
        let p = parents(&[(101, OWN), (200, 1), (300, 1)]);
        let s = [session(101, "screenshare.exe"), session(200, "chrome.exe"), session(300, "spotify.exe")];
        assert_eq!(plan_captures(&s, &p, OWN, &HashSet::new()), BTreeSet::from([200, 300]));
        let ids: Vec<_> = list_apps(&s, &p, OWN).into_iter().map(|a| a.id).collect();
        assert_eq!(ids, ["chrome.exe", "spotify.exe"]);
    }

    #[test]
    fn bloqueado_fica_de_fora() {
        let p = parents(&[(200, 1), (300, 1)]);
        let s = [session(200, "chrome.exe"), session(300, "discord.exe")];
        let blocked = HashSet::from(["discord.exe".to_string()]);
        assert_eq!(plan_captures(&s, &p, OWN, &blocked), BTreeSet::from([200]));
    }

    #[test]
    fn filho_de_processo_capturado_nao_duplica() {
        // O áudio do Chrome sai de um processo filho; os dois têm sessão.
        let p = parents(&[(200, 1), (201, 200)]);
        let s = [session(200, "chrome.exe"), session(201, "chrome.exe")];
        assert_eq!(plan_captures(&s, &p, OWN, &HashSet::new()), BTreeSet::from([200]));
    }

    #[test]
    fn ancestral_de_bloqueado_nao_e_capturado_inteiro() {
        // Launcher (400) abriu o jogo (401, bloqueado) e o navegador (402).
        let p = parents(&[(400, 1), (401, 400), (402, 400)]);
        let s = [session(400, "launcher.exe"), session(401, "game.exe"), session(402, "browser.exe")];
        let blocked = HashSet::from(["game.exe".to_string()]);
        assert_eq!(plan_captures(&s, &p, OWN, &blocked), BTreeSet::from([402]));
    }

    #[test]
    fn ancestral_do_proprio_app_nao_e_capturado_inteiro() {
        // Um terminal (50) que toca som abriu o ScreenShare.
        let p = parents(&[(OWN, 50), (101, OWN)]);
        let s = [session(50, "terminal.exe"), session(101, "screenshare.exe")];
        assert!(plan_captures(&s, &p, OWN, &HashSet::new()).is_empty());
        assert_eq!(list_apps(&s, &p, OWN).len(), 1);
    }

    #[test]
    fn ignora_sons_do_sistema_e_ciclos() {
        let p = parents(&[(200, 201), (201, 200)]);
        let s = [session(0, "system"), session(200, "a.exe"), session(201, "b.exe")];
        let plan = plan_captures(&s, &p, OWN, &HashSet::new());
        assert!(!plan.contains(&0));
        assert!(list_apps(&s, &p, OWN).iter().all(|a| a.id != "system"));
    }
}
