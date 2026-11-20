# Diagnóstico do áudio por app do ScreenShare no Windows.
# Uso (PowerShell, uma linha):
#   irm https://raw.githubusercontent.com/igornunesfontoura/screenshare/main/scripts/diagnose-win-audio.ps1 | iex
# Ou dois cliques em scripts/diagnose-win-audio.cmd.
# Deixe algo tocando som (vídeo, música) antes de rodar. Não altera nada no sistema.

$lines = New-Object System.Collections.Generic.List[string]
function Log([string]$text) { Write-Host $text; $lines.Add($text) }

Log "== ScreenShare: diagnóstico do áudio por app =="
Log "Windows: $([Environment]::OSVersion.VersionString)"

# Onde está o helper: app aberto, instalador ou .exe portátil (extraído no TEMP).
$candidates = @()
Get-Process ScreenShare -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Path) { $candidates += Join-Path (Split-Path $_.Path) "resources\screenshare-audio.exe" }
}
$candidates += "$env:LOCALAPPDATA\Programs\ScreenShare\resources\screenshare-audio.exe"
$candidates += "$env:ProgramFiles\ScreenShare\resources\screenshare-audio.exe"
$candidates += Get-ChildItem $env:TEMP -Recurse -Depth 4 -Filter screenshare-audio.exe -ErrorAction SilentlyContinue |
  ForEach-Object { $_.FullName }
$exe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $exe) {
  Log "Helper NÃO encontrado. Procurado em:"
  $candidates | ForEach-Object { Log "  $_" }
} else {
  Log "Helper: $exe"
  Log ""
  Log "== Apps com áudio (sessions) =="
  $sessions = & $exe sessions --own-pid 0 2>&1
  Log ($sessions | Out-String).Trim()
  Log "código de saída: $LASTEXITCODE"

  Log ""
  Log "== Captura de 5 segundos (capture) =="
  $raw = Join-Path $env:TEMP "ss-audio.raw"
  $err = Join-Path $env:TEMP "ss-audio.err"
  Remove-Item $raw, $err -ErrorAction SilentlyContinue
  $p = Start-Process $exe -ArgumentList "capture --own-pid 0" -RedirectStandardOutput $raw `
    -RedirectStandardError $err -PassThru -NoNewWindow
  Start-Sleep 5
  Stop-Process $p -ErrorAction SilentlyContinue
  Start-Sleep 1
  $errors = if (Test-Path $err) { (Get-Content $err | Out-String).Trim() } else { "" }
  Log ("erros do helper: " + $(if ($errors) { "`n$errors" } else { "(nenhum)" }))

  if (Test-Path $raw) {
    $bytes = [IO.File]::ReadAllBytes($raw)
    $max = 0.0; $loud = 0; $samples = 0
    for ($i = 0; $i + 4 -le $bytes.Length; $i += 400) {
      $v = [Math]::Abs([BitConverter]::ToSingle($bytes, $i)); $samples++
      if ($v -gt $max) { $max = $v }
      if ($v -gt 0.001) { $loud++ }
    }
    Log "bytes: $($bytes.Length) (esperado ~1.900.000 em 5 s)"
    Log ("pico: {0:N4} | amostras com som: {1} de {2}" -f $max, $loud, $samples)
  } else {
    Log "nenhum áudio foi escrito pelo helper"
  }
}

$report = Join-Path ([Environment]::GetFolderPath("Desktop")) "screenshare-diagnostico.txt"
$lines | Set-Content -Path $report -Encoding UTF8
try { $lines -join "`r`n" | Set-Clipboard; $copied = " e copiado para a área de transferência" } catch { $copied = "" }
Write-Host ""
Write-Host "Resultado salvo em $report$copied."
Read-Host "Enter para fechar"
