# Local static server for the budget app.
# Serves this folder on http://localhost:5173 only (loopback), then opens the browser.
# The port is fixed on purpose: the browser stores the data (IndexedDB) per origin,
# so changing the port would make the saved data "disappear".

$ErrorActionPreference = 'Stop'
$port = 5173
$url = "http://localhost:$port/"
$root = [IO.Path]::GetFullPath($PSScriptRoot)

# ---------- 1. Make sure third-party files exist (downloaded once, then works offline) ----------
$vendor = @(
  @('vendor\tesseract\tesseract.min.js',                'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'),
  @('vendor\tesseract\worker.min.js',                   'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js'),
  @('vendor\tesseract-core\tesseract-core.wasm.js',     'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js'),
  @('vendor\tesseract-core\tesseract-core-simd.wasm.js','https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm.js'),
  @('vendor\tesseract-core\tesseract-core-lstm.wasm.js','https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js'),
  @('vendor\tesseract-core\tesseract-core-simd-lstm.wasm.js','https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js'),
  @('vendor\lang\heb.traineddata.gz',                   'https://cdn.jsdelivr.net/npm/@tesseract.js-data/heb/4.0.0_best_int/heb.traineddata.gz'),
  @('vendor\lang\eng.traineddata.gz',                   'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  @('vendor\chart\chart.umd.min.js',                    'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'),
  @('vendor\fonts\heebo-hebrew.woff2',                  'https://cdn.jsdelivr.net/npm/@fontsource-variable/heebo@5/files/heebo-hebrew-wght-normal.woff2'),
  @('vendor\fonts\heebo-latin.woff2',                   'https://cdn.jsdelivr.net/npm/@fontsource-variable/heebo@5/files/heebo-latin-wght-normal.woff2')
)
$missing = $vendor | Where-Object { -not (Test-Path (Join-Path $root $_[0])) }
if ($missing) {
  Write-Host 'Installing missing components (one time only)...' -ForegroundColor Yellow
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  foreach ($item in $missing) {
    $target = Join-Path $root $item[0]
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Write-Host "  downloading $($item[0])"
    try { Invoke-WebRequest -UseBasicParsing -Uri $item[1] -OutFile $target }
    catch { Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red }
  }
}

# ---------- 2. Already running? just open the browser ----------
try {
  $probe = New-Object Net.Sockets.TcpClient
  $probe.Connect('127.0.0.1', $port)
  $probe.Close()
  Write-Host 'The app is already running - opening the browser.'
  Start-Process $url
  exit
} catch { }

# ---------- 3. Serve ----------
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.woff2' = 'font/woff2'
  '.wasm' = 'application/wasm'
  '.gz'   = 'application/octet-stream'
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()

Write-Host ''
Write-Host "  Budget app is running at $url" -ForegroundColor Green
Write-Host '  Keep this window open while using the app. Close it to stop.'
Write-Host ''
if (-not $env:BUDGET_NO_BROWSER) { Start-Process $url }

while ($listener.IsListening) {
  $task = $listener.GetContextAsync()
  while (-not $task.AsyncWaitHandle.WaitOne(300)) { }   # lets Ctrl+C work
  $ctx = $task.GetAwaiter().GetResult()
  $res = $ctx.Response
  try {
    $req = $ctx.Request
    if (-not $req.IsLocal) { $res.StatusCode = 403; continue }
    $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($full)) {
      $res.StatusCode = 404
      continue
    }
    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    $type = $mime[$ext]
    if (-not $type) { $type = 'application/octet-stream' }
    $bytes = [IO.File]::ReadAllBytes($full)
    $res.ContentType = $type
    $res.Headers.Add('Cache-Control', 'no-cache')
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.OutputStream.Close() } catch { }
  }
}
