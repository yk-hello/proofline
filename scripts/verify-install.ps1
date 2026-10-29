# Real-installer check on this PC: upgrade the installed Proofline to the new build,
# upgrade it again, uninstall, reinstall, and confirm ProoflineData survives each step.
# Leaves the new version installed in the same folder. Close Proofline first.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root '_sync\verify-install.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"" | Set-Content -Encoding UTF8 $log
function Log($text) { $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $text; Write-Host $line; Add-Content -Encoding UTF8 $log $line }
function Check($name, $ok) { if ($ok) { Log "PASS  $name" } else { Log "FAIL  $name"; $script:failed = $true } }
$failed = $false
try {
  $setup = Get-ChildItem (Join-Path $root 'release') -Filter 'Proofline-*-Setup-x64.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $setup) { throw 'No installer in release\' }
  Log "Installer: $($setup.Name)  $($setup.LastWriteTime)"
  if (Get-Process -Name Proofline, Redline -ErrorAction SilentlyContinue) { throw 'Proofline is running. Close it (including the tray) and run this again.' }
  $key = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -match '^(Proofline|Redline)( |$)' } | Select-Object -First 1
  $dir = if ($key) { (Get-ItemProperty $key.PSPath).InstallLocation } else { Join-Path $env:LOCALAPPDATA 'Programs\Proofline' }
  $dir = $dir.TrimEnd('\')
  Log "Install folder: $dir  (existing install: $([bool]$key))"
  function Install() {
    $p = Start-Process -FilePath $setup.FullName -ArgumentList @('/S', '/currentuser', "/D=$dir") -PassThru -Wait
    Start-Sleep -Seconds 3
    Get-Process -Name Proofline -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    return $p.ExitCode
  }
  $exe = Join-Path $dir 'Proofline.exe'
  $marker = Join-Path $dir 'ProoflineData\annotations\upgrade-check.json'

  $hadLegacy = Test-Path (Join-Path $dir 'RedlineData')
  Log 'Step 1: install the new build over the current one'
  Check 'installer exit code 0' ((Install) -eq 0)
  Check 'Proofline.exe present' (Test-Path $exe)
  Check 'old Redline.exe removed' (-not (Test-Path (Join-Path $dir 'Redline.exe')))
  if ($hadLegacy) { Check 'existing RedlineData kept (the app renames it to ProoflineData on first start)' (Test-Path (Join-Path $dir 'RedlineData')) }
  New-Item -ItemType Directory -Force -Path (Split-Path $marker) | Out-Null
  '{"redline":1,"marks":[{"id":"upgrade-check"}]}' | Set-Content -Encoding UTF8 $marker
  $real = Get-ChildItem (Join-Path $dir 'ProoflineData') -Recurse -File | Where-Object { $_.FullName -ne $marker } | Measure-Object
  Log "ProoflineData files besides the check file: $($real.Count)"

  Log 'Step 2: install again (runs the new uninstaller in upgrade mode)'
  Check 'installer exit code 0' ((Install) -eq 0)
  Check 'Proofline.exe present after upgrade' (Test-Path $exe)
  Check 'ProoflineData kept after upgrade' (Test-Path $marker)

  Log 'Step 3: uninstall'
  $uninstaller = Join-Path $dir 'Uninstall Proofline.exe'
  Check 'uninstaller present' (Test-Path $uninstaller)
  Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser', "_?=$dir") -Wait
  Start-Sleep -Seconds 3
  Check 'Proofline.exe removed' (-not (Test-Path $exe))
  Check 'ProoflineData kept after uninstall' (Test-Path $marker)
  $left = Get-ChildItem $dir -Force | Where-Object { $_.Name -notin @('ProoflineData', 'RedlineData', 'Uninstall Proofline.exe') }
  Check 'no other program files left' ($left.Count -eq 0)
  if ($left) { Log ("  left: " + ($left.Name -join ', ')) }

  Log 'Step 4: reinstall'
  Check 'installer exit code 0' ((Install) -eq 0)
  Check 'Proofline.exe present after reinstall' (Test-Path $exe)
  Check 'ProoflineData still there after reinstall' (Test-Path $marker)
  $assoc = (Get-ItemProperty 'HKCU:\Software\Classes\.md' -ErrorAction SilentlyContinue).'(default)'
  Log "  .md registered as: $assoc"
  Remove-Item $marker -Force
} catch { Log "ERROR $($_.Exception.Message)"; $failed = $true }
if ($failed) { Log 'RESULT: FAILED' } else { Log 'RESULT: ALL PASSED' }
