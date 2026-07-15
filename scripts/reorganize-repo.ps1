$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Move-IfExists {
    param([string]$From, [string]$To)
    $fromPath = Join-Path $Root $From
    if (-not (Test-Path -LiteralPath $fromPath)) { return }
    $toDir = Split-Path -Parent (Join-Path $Root $To)
    if ($toDir -and -not (Test-Path -LiteralPath $toDir)) {
        New-Item -ItemType Directory -Path $toDir -Force | Out-Null
    }
    $dest = Join-Path $Root $To
    if (Test-Path -LiteralPath $dest) { return }
    Move-Item -LiteralPath $fromPath -Destination $dest -Force
    Write-Host "Moved: $From -> $To"
}

# Ensure target folders exist
@(
    "web\artifacts",
    "web\wireframes",
    "mobile\miniapp-prep",
    "mobile\artifacts",
    "参考资料\audits",
    "参考资料\project-lessons"
) | ForEach-Object {
    $p = Join-Path $Root $_
    if (-not (Test-Path -LiteralPath $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
}

# Mobile: miniapp prep docs
if (Test-Path -LiteralPath (Join-Path $Root "docs\miniapp-prep")) {
    Get-ChildItem -LiteralPath (Join-Path $Root "docs\miniapp-prep") -File | ForEach-Object {
        Move-IfExists -From ("docs\miniapp-prep\" + $_.Name) -To ("mobile\miniapp-prep\" + $_.Name)
    }
}

# Mobile: 390px screenshots and notes
Get-ChildItem -LiteralPath $Root -File | Where-Object {
    $_.Name -match '-390(\.|$)' -or $_.Name -eq 'live-mobile.png' -or $_.Name -eq 'desktop-smoke-mobile-report.png'
} | ForEach-Object {
    Move-IfExists -From $_.Name -To ("mobile\artifacts\" + $_.Name)
}

# Web: 1280px screenshots and notes
Get-ChildItem -LiteralPath $Root -File | Where-Object {
    $_.Name -match '-1280(\.|$)' -or $_.Name -eq 'artifacts-home-1280.png' -or $_.Name -eq 'desktop-dashboard.png'
} | ForEach-Object {
    Move-IfExists -From $_.Name -To ("web\artifacts\" + $_.Name)
}

# Web: wireframes and entry pages
@(
    "page2_live_assistant_wireframe.html",
    "page3_mock_interview_wireframe.html",
    "experience-entry.html",
    "体验入口.html"
) | ForEach-Object { Move-IfExists -From $_ -To ("web\wireframes\" + $_) }

# Web: codex artifacts folder
Move-IfExists -From ".codex-artifacts" -To "web\artifacts\.codex-artifacts"

# Reference: audits and lessons
if (Test-Path -LiteralPath (Join-Path $Root "docs\audits")) {
    Get-ChildItem -LiteralPath (Join-Path $Root "docs\audits") -File | ForEach-Object {
        Move-IfExists -From ("docs\audits\" + $_.Name) -To ("参考资料\audits\" + $_.Name)
    }
}
if (Test-Path -LiteralPath (Join-Path $Root "docs\project-lessons")) {
    Get-ChildItem -LiteralPath (Join-Path $Root "docs\project-lessons") -File | ForEach-Object {
        Move-IfExists -From ("docs\project-lessons\" + $_.Name) -To ("参考资料\project-lessons\" + $_.Name)
    }
}

# Clean empty docs folder
$docsPath = Join-Path $Root "docs"
if (Test-Path -LiteralPath $docsPath) {
    $remaining = Get-ChildItem -LiteralPath $docsPath -Recurse -Force
    if ($remaining.Count -eq 0) {
        Remove-Item -LiteralPath $docsPath -Recurse -Force
        Write-Host "Removed empty docs/"
    }
}

# Remaining web/mobile artifacts
@(
    @("home-1280-after-style.md", "web\artifacts\home-1280-after-style.md"),
    @("home-1280-after-style.png", "web\artifacts\home-1280-after-style.png"),
    @("home-1280-snapshot.md", "web\artifacts\home-1280-snapshot.md"),
    @("mock-1280-final.png", "web\artifacts\mock-1280-final.png"),
    @("mock-390-final.png", "mobile\artifacts\mock-390-final.png"),
    @("mock-390-source-fixed.png", "mobile\artifacts\mock-390-source-fixed.png")
) | ForEach-Object {
    Move-IfExists -From $_[0] -To $_[1]
}

Get-ChildItem -LiteralPath $Root -Filter "*入口*.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not (Test-Path -LiteralPath (Join-Path $Root "web\wireframes\体验入口.html"))) {
        Move-Item -LiteralPath $_.FullName -Destination (Join-Path $Root "web\wireframes\体验入口.html") -Force
        Write-Host "Moved: 体验入口.html"
    }
}

Get-ChildItem -LiteralPath $Root -Filter "*.txt" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Force
    Write-Host "Removed: $($_.Name)"
}

Write-Host "Reorganization complete."
