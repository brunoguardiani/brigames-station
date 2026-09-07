# Regenerate the committed NSIS artwork using the existing application logo.
# Windows only; no external graphics dependencies are required.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$desktopDirectory = Split-Path -Parent $PSScriptRoot
$artworkDirectory = Join-Path $desktopDirectory 'installer'
$logo = [System.Drawing.Image]::FromFile((Join-Path $desktopDirectory 'src/assets/brigames-station-icon.png'))

function Save-InstallerArtwork([string]$Name, [int]$Width, [int]$Height, [scriptblock]$Draw) {
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#14161d'))
        & $Draw $graphics
        $bitmap.Save((Join-Path $artworkDirectory $Name), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    Save-InstallerArtwork 'update-surface.bmp' 1040 840 {
        param($graphics)
        # A purpose-built update surface at 2x. Text and live progress are
        # separate controls so version information stays dynamic/accessible.
        $muted = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#a3abbc'))
        $wordmark = [System.Drawing.Font]::new('Segoe UI', 22, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        try {
            # Subtle concentric glow, with the lower text area kept solid.
            for ($radius = 210; $radius -ge 110; $radius -= 2) {
                $alpha = [int](2 + (210 - $radius) / 30)
                $glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($alpha, 118, 108, 246))
                $graphics.FillEllipse($glow, (520 - $radius), (280 - $radius), (2 * $radius), (2 * $radius))
                $glow.Dispose()
            }
            $ring = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#373147'), 2)
            $arc = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#a59eff'), 3)
            $dot = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#a59eff'))
            try {
                $graphics.DrawEllipse($ring, 365, 125, 310, 310)
                $graphics.DrawArc($arc, 365, 125, 310, 310, 228, 47)
                $graphics.FillEllipse($dot, 641, 357, 9, 9)
                $graphics.DrawImage($logo, [System.Drawing.Rectangle]::new(414, 174, 212, 212))
            } finally { $ring.Dispose(); $arc.Dispose(); $dot.Dispose() }
            $graphics.DrawString('BRIGAMES STATION', $wordmark, $muted, 72, 52)
        } finally { $muted.Dispose(); $wordmark.Dispose() }
    }
    # 2x the NSIS reference dimensions, scaled by MUI to fit the current DPI.
    Save-InstallerArtwork 'header.bmp' 300 114 {
        param($graphics)
        $graphics.DrawImage($logo, [System.Drawing.Rectangle]::new(184, 12, 90, 90))
    }
    Save-InstallerArtwork 'sidebar.bmp' 328 628 {
        param($graphics)
        $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            [System.Drawing.Rectangle]::new(0, 0, 328, 628),
            [System.Drawing.ColorTranslator]::FromHtml('#292343'),
            [System.Drawing.ColorTranslator]::FromHtml('#14161d'), 90.0)
        $ring = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#443a6b'), 2)
        $white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#f3f4f8'))
        $muted = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#a3abbc'))
        $accent = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#766cf6'))
        $titleFont = [System.Drawing.Font]::new('Segoe UI', 29, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $bodyFont = [System.Drawing.Font]::new('Segoe UI', 19, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        try {
            $graphics.FillRectangle($gradient, 0, 0, 328, 628)
            $graphics.DrawEllipse($ring, -105, 12, 450, 450)
            $graphics.DrawEllipse($ring, -65, 52, 370, 370)
            $graphics.DrawImage($logo, [System.Drawing.Rectangle]::new(54, 128, 220, 220))
            $graphics.FillRectangle($accent, 32, 420, 44, 5)
            $graphics.DrawString('Brigames', $titleFont, $white, 30, 445)
            $graphics.DrawString('Station', $titleFont, $white, 30, 480)
            $graphics.DrawString('Sua comunidade,', $bodyFont, $muted, 32, 543)
            $graphics.DrawString('sempre por perto.', $bodyFont, $muted, 32, 570)
        } finally {
            $gradient.Dispose(); $ring.Dispose(); $white.Dispose(); $muted.Dispose()
            $accent.Dispose(); $titleFont.Dispose(); $bodyFont.Dispose()
        }
    }
} finally {
    $logo.Dispose()
}
