# Keeps Windows from sleeping while a long unattended run is in progress (`/run-phase`: the e2e
# suite at three local workers, one unit after another). Uses the system's own request
# (SetThreadExecutionState with ES_CONTINUOUS | ES_SYSTEM_REQUIRED), so nothing is simulated and
# the display may still turn off. Stop it with Ctrl+C or by ending the process; the request is
# released when the process exits. Windows only; other platforms need `caffeinate` or similar.

$signature = @"
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
"@
$kernel = Add-Type -MemberDefinition $signature -Name "KeepAwake" -Namespace "MaxOff" -PassThru

$ES_CONTINUOUS = [uint32]0x80000000
$ES_SYSTEM_REQUIRED = [uint32]0x00000001

try {
    Write-Host "keep-awake: holding the system awake (Ctrl+C to release)."
    while ($true) {
        # Re-assert every minute: a continuous request survives, but a re-assert is harmless and
        # keeps the loop honest if something else clears it.
        [void]$kernel::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
        Start-Sleep -Seconds 60
    }
}
finally {
    [void]$kernel::SetThreadExecutionState($ES_CONTINUOUS)
    Write-Host "keep-awake: released."
}
