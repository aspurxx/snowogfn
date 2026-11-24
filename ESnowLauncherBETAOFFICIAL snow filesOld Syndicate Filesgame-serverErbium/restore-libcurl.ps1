# Restores the exact libcurl dependency files used by the original Erbium source.
# Run this script before building Erbium.vcxproj if the libcurl folder is missing.
$ErrorActionPreference = "Stop"

$sourceCommit = "2035ea16cdc7a183ed4310058b38066c482e0741"
$sourceRoot = "https://raw.githubusercontent.com/Sacttt/Syndicate-Source-Code/$sourceCommit/SyndicateClassic/game-server/Erbium/libcurl"
$destination = Join-Path $PSScriptRoot "libcurl"
New-Item -ItemType Directory -Force -Path $destination | Out-Null

$files = @(
    @{ Name = "curl.h";           Sha = "f5e6777f89de2c2865b82459239cb9adb7657e8c" },
    @{ Name = "curlver.h";        Sha = "3a3d16e85e4158accdb7c667d12cc1af287b3076" },
    @{ Name = "easy.h";           Sha = "9c7e63adad6ebc0c72b5afd24989eaa664205310" },
    @{ Name = "header.h";         Sha = "6af29c0c0a4b1feaad29a344134b44fd98a77808" },
    @{ Name = "libcurl.lib";      Sha = "67de41856581de8f5e689c714d2e56251bdeba6f" },
    @{ Name = "mprintf.h";        Sha = "cb948dcd97b4d3a106ae04e516f21defcc81280e" },
    @{ Name = "multi.h";          Sha = "30104925b7eb4fb73a4c4ab9a4a5c1640496d6c8" },
    @{ Name = "options.h";        Sha = "c8ac827c077ca6ebe30ca8345afd8b530d4c6e58" },
    @{ Name = "stdcheaders.h";    Sha = "82e1b5fef6d5c032c9e2e6e8c1af59ecf25d6f39" },
    @{ Name = "system.h";         Sha = "8d56b8a4a1baafeb07269540107df68d631e5aee" },
    @{ Name = "typecheck-gcc.h";  Sha = "2dabcb41664de9645d7b020d7df51f123719639d" },
    @{ Name = "urlapi.h";         Sha = "e15c213ccdf7529a0b5a43c4fb4e7cdf212f596a" },
    @{ Name = "zlib.lib";         Sha = "1e55507b29f9c08a2f0cd5ff1fe9508f38a75992" }
)

function Get-GitBlobSha1([string]$FilePath) {
    $data = [System.IO.File]::ReadAllBytes($FilePath)
    $prefix = [System.Text.Encoding]::UTF8.GetBytes("blob $($data.Length)`0")
    $stream = New-Object System.IO.MemoryStream
    try {
        $stream.Write($prefix, 0, $prefix.Length)
        $stream.Write($data, 0, $data.Length)
        $sha = [System.Security.Cryptography.SHA1]::Create()
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream.ToArray()))).Replace("-", "").ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

foreach ($file in $files) {
    $target = Join-Path $destination $file.Name
    $temporary = "$target.download"
    Write-Host "Checking $($file.Name)..."
    Invoke-WebRequest -Uri "$sourceRoot/$($file.Name)" -OutFile $temporary -UseBasicParsing
    $actualSha = Get-GitBlobSha1 $temporary
    if ($actualSha -ne $file.Sha) {
        Remove-Item -Force $temporary -ErrorAction SilentlyContinue
        throw "Integrity check failed for $($file.Name). Expected $($file.Sha), got $actualSha."
    }
    Move-Item -Force $temporary $target
    Write-Host "Restored and verified $($file.Name)."
}

Write-Host "All 13 original Erbium libcurl dependency files are restored."
