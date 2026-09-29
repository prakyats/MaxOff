# Prints the app guide (MaxOff-App-Guide.html) and the staff first-day page (first-day.html) to PDFs
# of the same names next to them, with Microsoft Edge.
# Run from anywhere: powershell -NoProfile -ExecutionPolicy Bypass -File docs/guide/build-pdf.ps1
$ErrorActionPreference = "Stop"
$edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe" }
foreach ($name in @("MaxOff-App-Guide", "first-day")) {
  $html = Join-Path $PSScriptRoot "$name.html"
  $pdf = Join-Path $PSScriptRoot "$name.pdf"
  $url = "file:///" + ($html -replace "\\", "/")
  # Edge logs harmless noise on stderr, so it runs as a separate process rather than inline.
  Start-Process -FilePath $edge -Wait -WindowStyle Hidden -ArgumentList @("--headless=new", "--disable-gpu", "--no-pdf-header-footer", "`"--print-to-pdf=$pdf`"", "`"$url`"")
  Get-Item $pdf | Select-Object Name, Length, LastWriteTime
}
