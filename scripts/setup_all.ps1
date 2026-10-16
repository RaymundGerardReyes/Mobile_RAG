# ==============================================================================
# Offline AI Tutor -- One-Click Environment Setup (Windows 11 / PowerShell)
# Target Architecture: Windows 11 host + RTX 4050 Laptop GPU (6 GB VRAM)
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$SkipGpuCheck,
    [switch]$SkipMobileBuild,
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " OFFLINE AI TUTOR -- ONE-CLICK SETUP (WINDOWS 11)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Repository root: $RepoRoot`n" -ForegroundColor DarkGray

# ------------------------------------------------------------------------------
# 1. Prerequisite Validation
# ------------------------------------------------------------------------------
Write-Host ">> [1/5] Checking prerequisites..." -ForegroundColor Yellow

# 1.1 Git
try {
    $gitVer = git --version
    Write-Host "   [OK] Git: $gitVer" -ForegroundColor Green
} catch {
    Write-Error "Git is not installed or not in PATH. Please install Git for Windows (https://git-scm.com)."
    exit 1
}

# 1.2 Python 3.11+
$pythonLauncher = $null
if (Get-Command "python" -ErrorAction SilentlyContinue) {
    $pythonLauncher = "python"
} elseif (Get-Command "py" -ErrorAction SilentlyContinue) {
    $pythonLauncher = "py"
} else {
    Write-Error "Python is not found. Please install Python 3.11 or higher (https://python.org)."
    exit 1
}

try {
    $pyVerRaw = & $pythonLauncher -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
    $pyMajor = & $pythonLauncher -c "import sys; print(sys.version_info.major)"
    $pyMinor = & $pythonLauncher -c "import sys; print(sys.version_info.minor)"

    if ([int]$pyMajor -ne 3 -or [int]$pyMinor -lt 11) {
        Write-Error "Python 3.11+ is required. Found Python $pyVerRaw."
        exit 1
    }
    Write-Host "   [OK] Python: v$pyVerRaw (>= 3.11 required)" -ForegroundColor Green
} catch {
    Write-Error "Failed to verify Python version: $_"
    exit 1
}

# 1.3 Node.js 18+
try {
    $nodeVerRaw = node --version
    $nodeMajor = [int]($nodeVerRaw -replace '^v(\d+)\..*', '$1')
    if ($nodeMajor -lt 18) {
        Write-Error "Node.js 18+ is required. Found $nodeVerRaw."
        exit 1
    }
    Write-Host "   [OK] Node.js: $nodeVerRaw (>= 18 required)" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not found or not in PATH. Please install Node.js 18+ (https://nodejs.org)."
    exit 1
}

# 1.4 NVIDIA GPU & CUDA check (RTX 4050 target)
if (-not $SkipGpuCheck) {
    if (Get-Command "nvidia-smi" -ErrorAction SilentlyContinue) {
        $gpuInfo = nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
        Write-Host "   [OK] NVIDIA GPU: $gpuInfo" -ForegroundColor Green

        $cudaCheck = $null
        try {
            $cudaCheck = & $pythonLauncher -c "import torch; print('CUDA: ' + str(torch.cuda.is_available()) + ' | Device: ' + (torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'None'))" 2>$null
        } catch {
            $cudaCheck = $null
        }
        if ($LASTEXITCODE -eq 0 -and $cudaCheck) {
            Write-Host "   [OK] PyTorch CUDA Status: $cudaCheck" -ForegroundColor Green
        } else {
            Write-Host "   [INFO] PyTorch CUDA acceleration will be verified once virtualenv dependencies are provisioned." -ForegroundColor DarkGray
        }
    } else {
        Write-Host "   [WARN] No NVIDIA GPU detected with nvidia-smi. CPU inference fallback will be used." -ForegroundColor DarkYellow
    }
}

# ------------------------------------------------------------------------------
# 2. Virtual Environment Provisioning & Activation
# ------------------------------------------------------------------------------
Write-Host "`n>> [2/5] Setting up Python virtual environment..." -ForegroundColor Yellow
$VenvDir = Join-Path $RepoRoot "training\.venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip = Join-Path $VenvDir "Scripts\pip.exe"
$VenvActivate = Join-Path $VenvDir "Scripts\Activate.ps1"

if (-not (Test-Path $VenvPython)) {
    Write-Host "   Creating virtual environment at training\.venv..." -ForegroundColor DarkGray
    & $pythonLauncher -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create virtual environment."
        exit 1
    }
}
Write-Host "   [OK] Virtualenv ready: $VenvDir" -ForegroundColor Green

# Activate virtual environment in current PowerShell session
if (Test-Path $VenvActivate) {
    Write-Host "   Activating virtual environment..." -ForegroundColor DarkGray
    . $VenvActivate
    Write-Host "   [OK] Virtualenv activated." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 3. Training Dependencies Installation
# ------------------------------------------------------------------------------
Write-Host "`n>> [3/5] Installing training pipeline dependencies..." -ForegroundColor Yellow
$TrainingDir = Join-Path $RepoRoot "training"
& $VenvPython -m pip install --upgrade pip --quiet
& $VenvPip install -e "$TrainingDir[dev]" --quiet

if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Python dependencies installed in editable mode." -ForegroundColor Green
} else {
    Write-Host "   [WARN] Editable install encountered warnings. Checking core modules..." -ForegroundColor DarkYellow
    & $VenvPython -c "import jsonschema, yaml; print('Core modules verified')"
}

# ------------------------------------------------------------------------------
# 4. Mobile TypeScript Build
# ------------------------------------------------------------------------------
if (-not $SkipMobileBuild) {
    Write-Host "`n>> [4/5] Building Mobile TypeScript Core..." -ForegroundColor Yellow
    $MobileDir = Join-Path $RepoRoot "mobile"
    Push-Location $MobileDir
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "   Running npm install in mobile/..." -ForegroundColor DarkGray
            cmd.exe /c "npm install"
            if ($LASTEXITCODE -ne 0) {
                Write-Error "npm install in mobile/ failed."
                exit 1
            }
        }
        cmd.exe /c "npm run build"
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Mobile TypeScript build failed."
            exit 1
        }
        Write-Host "   [OK] Mobile TypeScript compiled to mobile/dist/." -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "`n>> [4/5] Skipping Mobile TypeScript Build" -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 5. Smoke Test and Health Check (Schema Contracts + SQLite Content Pack)
# ------------------------------------------------------------------------------
if (-not $SkipSmokeTest) {
    Write-Host "`n>> [5/5] Running Smoke Test and Health Check..." -ForegroundColor Yellow
    
    # 5.1 Contract Schema Validation Smoke Test
    Write-Host "   [5.1] Verifying Contract Schemas..." -ForegroundColor DarkGray
    $ValidateScript = Join-Path $RepoRoot "scripts\validate_contracts.py"
    $ExtractedPages = Join-Path $RepoRoot "training\artifacts\extracted_pages.jsonl"
    $PageSchema = Join-Path $RepoRoot "contracts\extracted-page.schema.json"
    
    if ((Test-Path $ValidateScript) -and (Test-Path $ExtractedPages) -and (Test-Path $PageSchema)) {
        & $VenvPython $ValidateScript $ExtractedPages $PageSchema
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Contract schema smoke test failed on extracted_pages.jsonl."
            exit 1
        }
        Write-Host "   [OK] Contract schema validated." -ForegroundColor Green
    } else {
        Write-Host "   [INFO] Pre-computed artifacts not yet built; skipping schema validation smoke test." -ForegroundColor DarkGray
    }

    # 5.2 SQLite Database Integrity and FTS5 Smoke Test
    Write-Host "   [5.2] Verifying SQLite Content Pack..." -ForegroundColor DarkGray
    $DbPath = Join-Path $RepoRoot "training\artifacts\content_pack.db"
    if (Test-Path $DbPath) {
        & $VenvPython -c "import sys, sqlite3; conn = sqlite3.connect(sys.argv[1]); assert conn.execute('PRAGMA integrity_check;').fetchone()[0] == 'ok'; assert not conn.execute('PRAGMA foreign_key_check;').fetchall(); print('   [OK] SQLite content pack verified'); conn.close()" $DbPath
        if ($LASTEXITCODE -ne 0) {
            Write-Error "SQLite database health check smoke test failed."
            exit 1
        }
    } else {
        Write-Host "   [INFO] content_pack.db not yet built; skipping DB smoke test." -ForegroundColor DarkGray
    }
} else {
    Write-Host "`n>> [5/5] Skipping Smoke Test" -ForegroundColor DarkGray
}

Write-Host "`n=======================================================" -ForegroundColor Green
Write-Host " SETUP COMPLETE - ALL SYSTEMS READY FOR DEVELOPMENT" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Run unit test suites:" -ForegroundColor White
Write-Host "     pytest training/tests" -ForegroundColor Gray
Write-Host "     cd mobile; npm test" -ForegroundColor Gray
Write-Host "  2. Package production release:" -ForegroundColor White
Write-Host "     python scripts/package_release.py --version 2026.10.1`n" -ForegroundColor Gray
