param(
    [string]$Action = 'get'
)

# read/write the SMTP settings used by notify.ps1
# payload arrives on stdin as JSON so the password never shows up in a command line
$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $PSCommandPath
$dataDir = Join-Path $here 'data'
$configPath = Join-Path $dataDir 'notify.config.json'
$authPath = Join-Path $dataDir 'auth.bin'

if (-not (Test-Path -LiteralPath $dataDir)) {
    try { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null } catch { }
}

$result = @{
    ok = $false
    configured = $false
    smtpServer = ''
    port = 587
    user = ''
    to = ''
    authSet = (Test-Path -LiteralPath $authPath)
    error = $null
}

function Write-Result($payload) {
    $payload | ConvertTo-Json -Compress
}

if ($Action -eq 'get') {
    if (Test-Path -LiteralPath $configPath) {
        try {
            $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $config.smtpServer) { $result.smtpServer = [string]$config.smtpServer }
            if ($null -ne $config.port) { $result.port = [int]$config.port }
            if ($null -ne $config.user) { $result.user = [string]$config.user }
            if ($null -ne $config.to) { $result.to = [string]$config.to }
            $result.configured = (-not [string]::IsNullOrWhiteSpace($result.user)) -and (-not [string]::IsNullOrWhiteSpace($result.to))
        } catch {
            $result.error = $_.Exception.Message
        }
    }
    $result.ok = $true
    Write-Result $result
    exit 0
}

if ($Action -eq 'save') {
    $raw = [Console]::In.ReadToEnd()
    $payload = $null
    try { $payload = $raw | ConvertFrom-Json } catch { }
    if ($null -eq $payload) {
        $result.error = 'invalid payload'
        Write-Result $result
        exit 1
    }

    $smtp = [string]$payload.smtpServer
    $port = 0
    [void][int]::TryParse([string]$payload.port, [ref]$port)
    $user = [string]$payload.user
    $to = [string]$payload.to
    $password = [string]$payload.password

    if ([string]::IsNullOrWhiteSpace($smtp)) { $smtp = 'smtp.qq.com' }
    if ($port -le 0) { $port = 587 }

    try {
        $config = [ordered]@{ smtpServer = $smtp; port = $port; user = $user; to = $to }
        ($config | ConvertTo-Json) | Set-Content -LiteralPath $configPath -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($password)) {
            $secure = ConvertTo-SecureString $password -AsPlainText -Force
            ($secure | ConvertFrom-SecureString) | Set-Content -LiteralPath $authPath -Encoding UTF8
        }
        $result.ok = $true
        $result.smtpServer = $smtp
        $result.port = $port
        $result.user = $user
        $result.to = $to
        $result.configured = (-not [string]::IsNullOrWhiteSpace($user)) -and (-not [string]::IsNullOrWhiteSpace($to))
        $result.authSet = (Test-Path -LiteralPath $authPath)
    } catch {
        $result.error = $_.Exception.Message
    }
    Write-Result $result
    exit 0
}

$result.error = 'unknown action'
Write-Result $result
exit 1
