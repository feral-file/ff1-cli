# Build Windows release asset: ff1-cli-windows-x64.zip and .sha256
# Run from repo root or scripts/release. Uses env: FF1_CLI_OUTPUT_DIR, FF1_CLI_NODE_VERSION, FF1_CLI_VERSION.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT_DIR = (Resolve-Path (Join-Path $ScriptDir "../..")).Path
$OUTPUT_DIR = if ($env:FF1_CLI_OUTPUT_DIR) { $env:FF1_CLI_OUTPUT_DIR } else { Join-Path $ROOT_DIR "release" }
$NODE_VERSION = if ($env:FF1_CLI_NODE_VERSION) { $env:FF1_CLI_NODE_VERSION } else { "20.12.2" }
$VERSION = if ($env:FF1_CLI_VERSION) { $env:FF1_CLI_VERSION } else {
    (Get-Content (Join-Path $ROOT_DIR "package.json") | ConvertFrom-Json).version
}

$OS = "windows"
$ARCH = "x64"
$NODE_OS = "win"
$NODE_ARCH = "x64"
$ASSET_NAME = "ff1-cli-$OS-$ARCH"
$ARCHIVE_NAME = "$ASSET_NAME.zip"

$WORKDIR = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_.FullName }
try {
    Write-Host "Building ff1-cli bundle..."
    Set-Location $ROOT_DIR
    npm ci
    npm run bundle
    npm prune --omit=dev

    $NODE_ARCHIVE = "node-v$NODE_VERSION-$NODE_OS-$NODE_ARCH.zip"
    $NODE_URL = "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE"
    Write-Host "Downloading Node.js $NODE_VERSION ($NODE_OS/$NODE_ARCH)..."
    Invoke-WebRequest -Uri $NODE_URL -OutFile (Join-Path $WORKDIR $NODE_ARCHIVE) -UseBasicParsing
    Expand-Archive -Path (Join-Path $WORKDIR $NODE_ARCHIVE) -DestinationPath $WORKDIR

    $NODE_DIR = Get-ChildItem -Path $WORKDIR -Filter "node-v$NODE_VERSION-$NODE_OS-$NODE_ARCH" -Directory | Select-Object -First 1
    $PACKAGE_DIR = Join-Path $WORKDIR $ASSET_NAME
    New-Item -ItemType Directory -Path (Join-Path $PACKAGE_DIR "bin") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $PACKAGE_DIR "lib") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $PACKAGE_DIR "node") -Force | Out-Null

    Copy-Item (Join-Path $ROOT_DIR "dist\ff1.js") (Join-Path $PACKAGE_DIR "lib\ff1.js")
    Copy-Item -Path (Join-Path $ROOT_DIR "node_modules") -Destination (Join-Path $PACKAGE_DIR "lib\node_modules") -Recurse -Force
    Copy-Item (Join-Path $NODE_DIR.FullName "node.exe") (Join-Path $PACKAGE_DIR "node\node.exe")
    Copy-Item (Join-Path $ROOT_DIR "package.json") (Join-Path $PACKAGE_DIR "package.json")
    Copy-Item (Join-Path $ROOT_DIR "LICENSE") (Join-Path $PACKAGE_DIR "LICENSE")
    Copy-Item (Join-Path $ROOT_DIR "README.md") (Join-Path $PACKAGE_DIR "README.md")

    $ff1Cmd = @"
@echo off
set "BASE_DIR=%~dp0.."
set "NODE=%BASE_DIR%\node\node.exe"
set "APP=%BASE_DIR%\lib\ff1.js"
"%NODE%" "%APP%" %*
"@
    [System.IO.File]::WriteAllText((Join-Path $PACKAGE_DIR "bin\ff1.cmd"), $ff1Cmd)

    New-Item -ItemType Directory -Path $OUTPUT_DIR -Force | Out-Null
    $zipPath = Join-Path $OUTPUT_DIR $ARCHIVE_NAME
    Compress-Archive -Path $PACKAGE_DIR -DestinationPath $zipPath -Force

    $hash = Get-FileHash -Path $zipPath -Algorithm SHA256
    $hash.Hash.ToLower() + "  " + (Split-Path -Leaf $zipPath) | Out-File -FilePath "$zipPath.sha256" -Encoding ASCII

    Write-Host "Built $ARCHIVE_NAME (version $VERSION) in $OUTPUT_DIR"
}
finally {
    Remove-Item -Path $WORKDIR -Recurse -Force -ErrorAction SilentlyContinue
}
