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
  Log "(lista vazia = o helper não está vendo nenhum app tocando)"
  $sessions = & $exe sessions --own-pid 0 2>&1
  Log ($sessions | Out-String).Trim()
  Log "código de saída: $LASTEXITCODE"

  Log ""
  Log "== Captura de 5 segundos (capture) =="
  # Lido como o app lê: stdout consumido sem parar e stdin aberto (EOF encerra o helper).
  $psi = New-Object System.Diagnostics.ProcessStartInfo $exe, "capture --own-pid 0"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $proc.StandardInput.WriteLine('{"blocked":[]}')
  $proc.StandardInput.Flush()
  $memory = New-Object IO.MemoryStream
  $copy = $proc.StandardOutput.BaseStream.CopyToAsync($memory)
  $errTask = $proc.StandardError.ReadToEndAsync()
  Start-Sleep 5
  $proc.StandardInput.Close()
  if (-not $proc.WaitForExit(3000)) { $proc.Kill(); Log "helper não encerrou com o fim do stdin (foi finalizado)" }
  # 0 = encerrou normalmente; -1073741819 (0xC0000005) ou -1073740940 (0xC0000374) = crash.
  Log ("código de saída do capture: {0} (0x{0:X8})" -f $proc.ExitCode)
  [void]$copy.Wait(3000)
  [void]$errTask.Wait(3000)
  $errors = "$($errTask.Result)".Trim()
  Log ("erros do helper: " + $(if ($errors) { "`n$errors" } else { "(nenhum)" }))

  $bytes = $memory.ToArray()
  $max = 0.0; $loud = 0; $samples = 0
  for ($i = 0; $i + 4 -le $bytes.Length; $i += 40) {
    $v = [Math]::Abs([BitConverter]::ToSingle($bytes, $i)); $samples++
    if ($v -gt $max) { $max = $v }
    if ($v -gt 0.001) { $loud++ }
  }
  Log "bytes: $($bytes.Length) (esperado ~1.900.000 em 5 s)"
  Log ("pico: {0:N4} | amostras com som: {1} de {2}" -f $max, $loud, $samples)
}

$report = Join-Path ([Environment]::GetFolderPath("Desktop")) "screenshare-diagnostico.txt"
$lines | Set-Content -Path $report -Encoding UTF8
try { $lines -join "`r`n" | Set-Clipboard; $copied = " e copiado para a área de transferência" } catch { $copied = "" }
Write-Host ""
Write-Host "Resultado salvo em $report$copied."
Read-Host "Enter para fechar"
