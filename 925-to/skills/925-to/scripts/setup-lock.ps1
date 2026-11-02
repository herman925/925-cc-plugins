param([Parameter(Mandatory=$true)][string]$LiteralPath)
$ErrorActionPreference = 'Stop'
$toHandle = $null
try {
    $toHandle = [System.IO.File]::Open($LiteralPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    [Console]::Out.WriteLine('locked')
    [Console]::Out.Flush()
    while ($null -ne [Console]::In.ReadLine()) { }
} finally {
    if ($null -ne $toHandle) { $toHandle.Dispose() }
}
