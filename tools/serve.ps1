# Static file server for Windows without any installs (plain PowerShell / .NET).
# ES modules need http://, not file://.
param([int]$Port = 8765, [switch]$NoBrowser)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
  Write-Host "Port $Port ist belegt - laeuft HEAVY STEEL schon? Oeffne den Browser trotzdem."
  Start-Process "http://localhost:$Port/"
  exit 0
}
Write-Host "HEAVY STEEL: http://localhost:$Port/   (dieses Fenster schliessen oder Strg+C beendet)"
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($rel.EndsWith('/')) { $rel += 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $rel.TrimStart('/')))
      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
