/**
 * tauri build --no-bundle 之后的后处理：
 * 1. 把 release exe 复制到 portable/ 作为绿色版
 * 2. 在桌面创建 DevKit 快捷方式
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const exe = path.join(root, 'src-tauri', 'target', 'release', 'devkit.exe')
const outDir = path.join(root, 'portable')

try {
  mkdirSync(outDir, { recursive: true })
  copyFileSync(exe, path.join(outDir, 'devkit.exe'))
} catch (e) {
  console.error(`复制 exe 失败（先执行 tauri build --no-bundle）：${e.message}`)
  process.exit(1)
}

if (process.platform !== 'win32') {
  console.log(`绿色版已输出到 ${outDir}（非 Windows 平台跳过桌面快捷方式）`)
} else {
  const q = (s) => s.replace(/'/g, "''")
  const ps = `
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desktop 'DevKit.lnk'))
$lnk.TargetPath = '${q(path.join(outDir, 'devkit.exe'))}'
$lnk.WorkingDirectory = '${q(outDir)}'
$lnk.Description = 'DevKit 开发者工具箱（绿色版）'
$lnk.Save()
Write-Host "桌面快捷方式: $(Join-Path $desktop 'DevKit.lnk')"
`
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' })
}
console.log(`绿色版: ${path.join(outDir, 'devkit.exe')}`)
