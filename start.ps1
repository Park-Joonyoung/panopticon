$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "명령 실행 실패 (종료 코드 $LASTEXITCODE): $Executable $($Arguments -join ' ')"
    }
}

function Test-Python {
    param([string]$Executable, [string[]]$Prefix = @(), [switch]$Venv)
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    $code = 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'
    if ($Venv) {
        $code = 'import sys; sys.exit(0 if sys.version_info >= (3, 9) and sys.prefix != sys.base_prefix else 1)'
    }
    try {
        & $Executable @Prefix -c $code 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

function Find-Python {
    foreach ($name in @('py.exe', 'python.exe')) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $command) { continue }
        # Avoid launching the Microsoft Store's uninstalled-Python shortcut.
        if ($name -eq 'python.exe' -and $command.Source -like '*\Microsoft\WindowsApps\*') { continue }
        $prefix = @()
        if ($name -eq 'py.exe') { $prefix = @('-3') }
        if (Test-Python -Executable $command.Source -Prefix $prefix) {
            return @{ Executable = $command.Source; Prefix = $prefix }
        }
    }
    $installed = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (Test-Python -Executable $installed) { return @{ Executable = $installed; Prefix = @() } }
    return $null
}

function Find-Node {
    $candidates = @()
    $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $candidates += $command.Source }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($base) { $candidates += Join-Path $base 'nodejs\node.exe' }
    }
    $candidates += Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $version = & $candidate --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { return $candidate }
        } catch { continue }
    }
    return $null
}

function Install-Package {
    param([string]$Id)
    $winget = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $winget) {
        throw '자동 설치에 필요한 winget이 없습니다. Microsoft Store에서 앱 설치 관리자(App Installer)를 설치한 다음 start.bat을 다시 실행해 주세요.'
    }
    Invoke-Checked -Executable $winget.Source -Arguments @(
        'install', '--id', $Id, '--exact', '--source', 'winget', '--silent',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
    )
    # Installers update the saved PATH, not the current terminal's environment.
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath;$env:Path"
}

function Test-ServerRunning {
    $connection = New-Object System.Net.Sockets.TcpClient
    try {
        $connection.Connect('127.0.0.1', 3000)
        return $true
    } catch { return $false }
    finally { $connection.Dispose() }
}

function Start-Panopticon {
    if (Test-ServerRunning) {
        Write-Host '이미 서버가 작동 중입니다.' -ForegroundColor Yellow
        Write-Host '브라우저에서 http://127.0.0.1:3000 을 열어 주세요.' -ForegroundColor Green
        Write-Host '아무 키나 누르면 이 창을 닫습니다.'
        [void][Console]::ReadKey($true)
        return
    }

    $venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    $requirements = Join-Path $PSScriptRoot 'requirements.txt'
    $stamp = Join-Path $PSScriptRoot '.venv\.panopticon-setup'
    if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) { throw 'requirements.txt 파일이 없습니다.' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'server.js') -PathType Leaf)) { throw 'server.js 파일이 없습니다.' }
    $hash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
    $venvReady = Test-Python -Executable $venvPython -Venv
    $node = Find-Node
    $ready = $venvReady -and $node -and (Test-Path -LiteralPath $stamp) -and
        ((Get-Content -LiteralPath $stamp -Raw).Trim() -eq $hash)

    if (-not $ready) {
        Write-Host '[1/5] Python 가상환경 준비' -ForegroundColor Cyan
        if (-not $venvReady) {
            $python = Find-Python
            if (-not $python) {
                Write-Host 'Python이 없어 Python 3.12를 설치합니다. 설치 승인 창이 뜨면 허용해 주세요.'
                Install-Package -Id 'Python.Python.3.12'
                $python = Find-Python
            }
            if (-not $python) { throw 'Python 설치를 확인할 수 없습니다. 터미널을 닫고 start.bat을 다시 실행해 주세요.' }
            Invoke-Checked -Executable $python.Executable -Arguments ($python.Prefix + @('-m', 'venv', '.venv'))
            if (-not (Test-Python -Executable $venvPython -Venv)) { throw '.venv의 Python을 실행할 수 없습니다.' }
        } else { Write-Host '기존 .venv를 사용합니다.' }

        Write-Host '[2/5] requirements.txt 설치' -ForegroundColor Cyan
        Invoke-Checked -Executable $venvPython -Arguments @('-m', 'pip', 'install', '-r', $requirements)
        Invoke-Checked -Executable $venvPython -Arguments @('-c', 'import pytchat')

        Write-Host '[3/5] Node.js 준비' -ForegroundColor Cyan
        if (-not $node) {
            Write-Host 'Node.js LTS를 설치합니다. 설치 승인 창이 뜨면 허용해 주세요.'
            Install-Package -Id 'OpenJS.NodeJS.LTS'
            $node = Find-Node
        } else { Write-Host '설치된 Node.js를 사용합니다.' }
        if (-not $node) { throw 'Node.js 설치를 확인할 수 없습니다. 터미널을 닫고 start.bat을 다시 실행해 주세요.' }

        # Mark ready only after every installation step succeeds.
        Set-Content -LiteralPath $stamp -Value $hash -Encoding ASCII
        Write-Host '첫 실행 준비가 완료되었습니다.' -ForegroundColor Green
    }

    Write-Host ''
    Write-Host '[4/5] 서버 실행' -ForegroundColor Cyan
    Write-Host '[5/5] 서버의 대시보드 주소가 표시되면 브라우저 주소창에 아래 주소를 붙여넣으세요.' -ForegroundColor Green
    Write-Host '      http://127.0.0.1:3000' -ForegroundColor Green
    Write-Host '이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.'
    Write-Host ''
    Invoke-Checked -Executable $node -Arguments @('server.js')
}

try { Start-Panopticon }
catch {
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
