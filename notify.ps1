param(
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$RemoteUrl = '',
    [string]$DesktopFile = '1',
    [string]$Toast = '1',
    [string]$Mail = '0',
    [string]$MailConfig = '',
    [string]$MailAuth = '',
    [string]$LogFile = ''
)

$ErrorActionPreference = 'Continue'

function Write-Log([string]$message) {
    if ([string]::IsNullOrWhiteSpace($LogFile)) { return }
    try {
        Add-Content -LiteralPath $LogFile -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message) -Encoding UTF8
    } catch { }
}

Write-Log "notify url=$Url remote=$RemoteUrl desktop=$DesktopFile toast=$Toast mail=$Mail"

if ($DesktopFile -eq '1') {
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        if ([string]::IsNullOrWhiteSpace($desktop)) { $desktop = Join-Path $env:USERPROFILE 'Desktop' }
        if (Test-Path -LiteralPath $desktop) {
            $path = Join-Path $desktop 'DSH-手机访问网址.txt'
            $lines = @('DSH 手机访问地址', '', '同一 Wi-Fi：', $Url)
            if (-not [string]::IsNullOrWhiteSpace($RemoteUrl)) {
                $lines += @('', '异地（手机装 Tailscale 并登录同一账号）：', $RemoteUrl)
            } else {
                $lines += @('', '异地：本机 Tailscale 未登录，安装并登录 Tailscale 后会显示异地地址。')
            }
            $lines += @('', '打开上面的地址即可操作电脑上的同一个 DSH 会话。', "更新于 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
            Set-Content -LiteralPath $path -Value ($lines -join "`r`n") -Encoding UTF8
            Write-Log "desktop file written: $path"
        } else {
            Write-Log "desktop directory missing: $desktop"
        }
    } catch {
        Write-Log "desktop file failed: $($_.Exception.Message)"
    }
}

if ($Toast -eq '1') {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $icon = New-Object System.Windows.Forms.NotifyIcon
        $icon.Icon = [System.Drawing.SystemIcons]::Information
        $icon.BalloonTipTitle = 'DSH 局域网访问'
        $icon.BalloonTipText = $Url
        $icon.Visible = $true
        $icon.ShowBalloonTip(8000)
        Start-Sleep -Seconds 9
        $icon.Dispose()
        Write-Log 'toast shown'
    } catch {
        Write-Log "toast failed: $($_.Exception.Message)"
    }
}

if ($Mail -eq '1' -and -not [string]::IsNullOrWhiteSpace($MailConfig) -and (Test-Path -LiteralPath $MailConfig)) {
    try {
        $config = Get-Content -LiteralPath $MailConfig -Raw -Encoding UTF8 | ConvertFrom-Json
        $authPath = $MailAuth
        if ([string]::IsNullOrWhiteSpace($authPath)) {
            $authPath = Join-Path (Split-Path -Parent $MailConfig) 'auth.bin'
        }
        if (-not (Test-Path -LiteralPath $authPath)) {
            Write-Log "mail skipped: auth file missing ($authPath)"
            Write-Output 'MAIL_SKIP auth file missing'
        } else {
            $secure = (Get-Content -LiteralPath $authPath -Raw -Encoding UTF8).Trim() | ConvertTo-SecureString
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            try {
                $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
            } finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            }
            $message = New-Object System.Net.Mail.MailMessage
            $message.From = New-Object System.Net.Mail.MailAddress($config.user)
            $message.To.Add($config.to)
            $message.Subject = '[DSH-LAN] 手机访问地址'
            $message.SubjectEncoding = [System.Text.Encoding]::UTF8
            $message.BodyEncoding = [System.Text.Encoding]::UTF8
            $bodyLines = @('DSH 手机访问地址（同一 Wi-Fi 用第一条）：', '', '局域网：', $Url)
            if (-not [string]::IsNullOrWhiteSpace($RemoteUrl)) {
                $bodyLines += @('', '异地（手机装 Tailscale 并登录同一账号）：', $RemoteUrl)
            }
            $bodyLines += @('', "发送时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
            $message.Body = ($bodyLines -join "`r`n")
            $client = New-Object System.Net.Mail.SmtpClient($config.smtpServer, [int]$config.port)
            $client.EnableSsl = $true
            $client.Credentials = New-Object System.Net.NetworkCredential($config.user, $password)
            $client.Send($message)
            $message.Dispose()
            $client.Dispose()
            Write-Log "mail sent to $($config.to)"
            Write-Output "MAIL_OK $($config.to)"
        }
    } catch {
        Write-Log "mail failed: $($_.Exception.Message)"
        Write-Output "MAIL_FAIL $($_.Exception.Message)"
    }
} elseif ($Mail -eq '1') {
    Write-Log "mail skipped: no config file ($MailConfig)"
    Write-Output 'MAIL_SKIP no smtp config'
}
