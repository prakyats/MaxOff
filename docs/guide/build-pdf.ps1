# Prints docs/guide/MaxOff-App-Guide.html to MaxOff-App-Guide.pdf next to it, with Microsoft Edge.
# Run from anywhere: powershell -NoProfile -ExecutionPolicy Bypass -File docs/guide/build-pdf.ps1
$ErrorActionPreference = "Stop"
$edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe" }
$html = Join-Path $PSScriptRoot "MaxOff-App-Guide.html"
$pdf = Join-Path $PSScriptRoot "MaxOff-App-Guide.pdf"
$url = "file:///" + ($html -replace "\\", "/")
# Edge logs harmless noise on stderr, so it runs as a separate process rather than inline.
Start-Process -FilePath $edge -Wait -WindowStyle Hidden -ArgumentList @("--headless=new", "--disable-gpu", "--no-pdf-header-footer", "`"--print-to-pdf=$pdf`"", "`"$url`"")
Get-Item $pdf | Select-Object Name, Length, LastWriteTime
