$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$cacheDir = Join-Path $repoRoot 'research\cache\fifa-rating-audit'
$cachePath = Join-Path $cacheDir 'lbenz_fifa05_20_player_stats.csv'
$url = 'https://raw.githubusercontent.com/lbenz730/fifa_model/master/player_stats.csv'
$expectedBytes = 62733624
$expectedSha256 = '90403e4a7d30e94198b4c031d805fe06f170833efcae0d738e04108bba436758'

if (Test-Path -LiteralPath $cachePath) {
    $existing = Get-Item -LiteralPath $cachePath
    $existingHash = (Get-FileHash -LiteralPath $cachePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($existing.Length -ne $expectedBytes -or $existingHash -ne $expectedSha256) {
        throw "Existing cache does not match the pinned manifest value; left unchanged: $cachePath"
    }
    Write-Output "Verified existing cache: $($existing.Length) bytes, SHA256 $existingHash"
    exit 0
}

New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
Invoke-WebRequest -Uri $url -OutFile $cachePath
$downloaded = Get-Item -LiteralPath $cachePath
$downloadedHash = (Get-FileHash -LiteralPath $cachePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($downloaded.Length -ne $expectedBytes -or $downloadedHash -ne $expectedSha256) {
    throw "Downloaded file does not match the pinned manifest value: bytes=$($downloaded.Length), sha256=$downloadedHash"
}
Write-Output "Verified cache: $($downloaded.Length) bytes, SHA256 $downloadedHash"
