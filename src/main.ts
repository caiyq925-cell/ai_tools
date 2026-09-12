import './styles.css'
import {
  appIcon,
  hideWindow,
  listApps,
  onWindowShown,
  openApp,
  quitApp,
  readText,
  startDragging,
  type AppEntry,
} from './bridge'
import { clear, el, type Child } from './dom'
import { tools, type ToolModule } from './tools'

const app = document.getElementById('app')!

/* ------------------------------------------------------------------ *
 * 外壳
 * ------------------------------------------------------------------ */

const header = el('div', { class: 'topbar' })
const content = el('div', { class: 'content' })
const footer = el('div', { class: 'footer' })
const shell = el('div', { class: 'shell' }, header, content, footer)
app.appendChild(shell)
enableDragRegion(header)

let currentTool: ToolModule | null = null
let disposeTool: (() => void) | null = null

/* ------------------------------------------------------------------ *
 * 背景透明度
 * ------------------------------------------------------------------ */

const OPACITY_KEY = 'devkit.opacity'
const OPACITY_MIN = 20
const OPACITY_MAX = 100

function readOpacity(): number {
  try {
    const saved = Number(localStorage.getItem(OPACITY_KEY))
    if (Number.isFinite(saved) && saved >= OPACITY_MIN && saved <= OPACITY_MAX) return saved
  } catch {
    /* 忽略存储不可用的情况 */
  }
  return 86
}

let opacityPercent = readOpacity()

function applyOpacity(percent: number): void {
  opacityPercent = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(percent)))
  document.documentElement.style.setProperty('--bg-alpha', String(opacityPercent / 100))
  try {
    localStorage.setItem(OPACITY_KEY, String(opacityPercent))
  } catch {
    /* 忽略 */
  }
}

function opacityControl(): HTMLElement {
  const range = el('input', {
    class: 'opacity-range',
    type: 'range',
    min: String(OPACITY_MIN),
    max: String(OPACITY_MAX),
    step: '1',
  })
  range.value = String(opacityPercent)
  const value = el('span', { class: 'opacity-value' }, `${opacityPercent}%`)
  range.addEventListener('input', () => {
    applyOpacity(Number(range.value))
    value.textContent = `${opacityPercent}%`
  })
  const wrap = el('div', { class: 'opacity', title: '调整背景透明度' }, el('span', { class: 'opacity-icon' }, '◐'), range, value)
  // 控件自身不是拖动区域，避免调透明度时把窗口拖走
  wrap.addEventListener('mousedown', (event) => event.stopPropagation())
  return wrap
}

/**
 * 顶栏拖动：命中交互控件以外的区域时，直接调用 Tauri 的 startDragging。
 * 比 data-tauri-drag-region 更可控，也保证输入框 / 滑块可以正常点击。
 */
const DRAG_IGNORE = 'input, select, textarea, button, a, .opacity, .topbar-back'

function enableDragRegion(root: HTMLElement): void {
  root.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest(DRAG_IGNORE)) return
    event.preventDefault()
    void startDragging().catch((error: unknown) => toast(`拖动失败：${error instanceof Error ? error.message : String(error)}`))
  })
}

/** 轻量错误提示，避免窗口操作失败时静默无反馈 */
function toast(message: string): void {
  let box = document.getElementById('devkit-toast')
  if (!box) {
    box = el('div', { id: 'devkit-toast', class: 'toast' })
    document.body.appendChild(box)
  }
  box.textContent = message
  box.classList.add('show')
  window.setTimeout(() => box?.classList.remove('show'), 6000)
}

/* ------------------------------------------------------------------ *
 * 匹配打分
 * ------------------------------------------------------------------ */

function subsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length === 0
}

function scoreTool(tool: ToolModule, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0

  const detected = tool.detect?.(query) ?? 0
  let score = detected * 1.5

  const name = tool.name.toLowerCase()
  if (tool.id === q) score += 60
  if (name === q) score += 70
  if (name.includes(q)) score += 40
  if (tool.desc.toLowerCase().includes(q)) score += 8
  for (const keyword of tool.keywords) {
    const kw = keyword.toLowerCase()
    if (kw === q) score += 30
    else if (kw.includes(q)) score += 14
  }
  if (!score && subsequence(q, name)) score += 10
  return score
}

function ranked(query: string): ToolModule[] {
  if (!query.trim()) return [...tools]
  return tools
    .map((tool) => ({ tool, score: scoreTool(tool, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.tool)
}

/* ------------------------------------------------------------------ *
 * 首页
 * ------------------------------------------------------------------ */

const searchInput = el('input', {
  class: 'search-input',
  placeholder: '输入命令，或直接粘贴内容…',
  spellcheck: 'false',
  autocomplete: 'off',
})

const listBox = el('div', { class: 'list' })

/** 首页列表项：既可以是内置工具，也可以是本机已安装的应用 */
type Entry = { kind: 'tool'; tool: ToolModule; text: string } | { kind: 'app'; app: AppEntry }

let entries: Entry[] = []
let activeIndex = 0
let clipboardHint: { tool: ToolModule; text: string } | null = null
let query = ''
let apps: AppEntry[] = []

/** 应用搜索结果上限，避免刷屏 */
const MAX_APP_RESULTS = 10

interface HeaderConfig {
  icon: string
  back?: boolean
  title?: string
  sub?: string
  search?: HTMLInputElement
  meta?: string
}

function renderHeader(config: HeaderConfig): void {
  clear(header)
  if (config.back) header.appendChild(el('div', { class: 'topbar-back', title: '返回 (Esc)', onclick: goHome }, '‹'))
  header.appendChild(el('div', { class: 'topbar-glyph' }, el('span', { class: 'glyph' }, config.icon)))
  if (config.search) {
    header.appendChild(config.search)
  } else {
    header.appendChild(
      el('div', { class: 'topbar-main' }, el('div', { class: 'topbar-title', text: config.title ?? '' }), el('div', { class: 'topbar-sub', text: config.sub ?? '' })),
    )
  }
  // 顶栏中间保留一段空白，既撑开右侧控件，也留出拖动窗口的位置
  const spacerClass = config.search ? 'toolbar-spacer topbar-spacer topbar-spacer-fixed' : 'toolbar-spacer topbar-spacer'
  header.appendChild(el('div', { class: spacerClass }))
  if (config.meta) header.appendChild(el('div', { class: 'topbar-meta' }, config.meta))
  header.appendChild(opacityControl())
}

function renderHomeHeader(): void {
  renderHeader({ icon: '⚡', search: searchInput, meta: 'Alt + Space' })
}

function renderHomeFooter(): void {
  clear(footer)
  footer.appendChild(el('span', {}, el('span', { class: 'kbd' }, '↑'), ' ', el('span', { class: 'kbd' }, '↓'), ' 选择'))
  footer.appendChild(el('span', {}, el('span', { class: 'kbd' }, '↵'), ' 打开'))
  footer.appendChild(el('span', {}, el('span', { class: 'kbd' }, 'Esc'), ' 隐藏窗口'))
  footer.appendChild(el('span', { title: '输入应用名称（如 微信、vscode）可直接启动本机应用' }, '输入应用名可启动应用'))
  footer.appendChild(el('span', { class: 'footer-spacer' }))
  footer.appendChild(el('span', { class: 'footer-link', onclick: () => void hideWindow() }, '隐藏'))
  footer.appendChild(el('span', { class: 'footer-link', onclick: () => void quitApp() }, '退出'))
}

function listItem(active: boolean, icon: Child, name: Child[], desc: string, onClick: () => void): HTMLElement {
  return el(
    'div',
    { class: `item${active ? ' active' : ''}`, onclick: onClick },
    el('div', { class: 'item-icon' }, icon),
    el('div', { class: 'item-main' }, el('div', { class: 'item-name' }, ...name), el('div', { class: 'item-desc' }, desc)),
    el('div', { class: 'item-enter' }, '↵'),
  )
}

function renderList(): void {
  clear(listBox)

  if (clipboardHint && !query.trim()) {
    const hint = clipboardHint
    listBox.appendChild(
      listItem(
        activeIndex === 0,
        el('span', { class: 'glyph' }, '📋'),
        ['使用剪贴板内容', el('span', { class: 'badge' }, hint.tool.name)],
        preview(hint.text),
        () => openTool(hint.tool, hint.text),
      ),
    )
  }

  if (!entries.length) {
    listBox.appendChild(
      el('div', { class: 'empty' }, query.trim() ? `没有匹配「${query}」的工具或应用` : '暂无可用功能'),
    )
    return
  }

  const offset = clipboardHint && !query.trim() ? 1 : 0
  entries.forEach((entry, index) => {
    const active = index + offset === activeIndex
    if (entry.kind === 'tool') {
      listBox.appendChild(
        listItem(active, el('span', { class: 'glyph' }, entry.tool.icon), [entry.tool.name], entry.tool.desc, () => openTool(entry.tool, entry.text)),
      )
      return
    }
    const app = entry.app
    const iconBox = el('span', { class: 'app-icon' }, initialOf(app.name))
    const img = el('img', { class: 'app-icon-img hidden', alt: '' })
    iconBox.appendChild(img)
    // 图标按需懒取，取到后覆盖首字回退
    void appIcon(app.path).then((src) => {
      if (!src) return
      img.src = src
      img.classList.remove('hidden')
      iconBox.classList.add('has-image')
    })
    listBox.appendChild(
      listItem(active, iconBox, [app.name, el('span', { class: 'badge badge-app' }, '应用')], app.path, () => void launchApp(app)),
    )
  })

  listBox.querySelectorAll('.item')[activeIndex]?.scrollIntoView({ block: 'nearest' })
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 72)
}

function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?'
}

/** 应用名打分：支持中文名、exe 名、前缀与模糊匹配 */
function scoreApp(app: AppEntry, q: string): number {
  const name = app.name.toLowerCase()
  const file = (app.path.split('\\').pop() ?? '').toLowerCase().replace(/\.(exe|lnk)$/, '')
  let score = 0
  if (name === q || file === q) score = 100
  else if (name.startsWith(q) || file.startsWith(q)) score = 72
  else if (name.includes(q)) score = 56
  else if (file.includes(q)) score = 46
  else if (subsequence(q, name) || subsequence(q, file)) score = 16
  if (!score) return 0
  // 名字越短，越可能是用户想找的那个
  return score + Math.max(0, 12 - name.length) / 2
}

function rankApps(rawQuery: string): AppEntry[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q || !apps.length) return []
  return apps
    .map((app) => ({ app, score: scoreApp(app, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_APP_RESULTS)
    .map((item) => item.app)
}

function refresh(): void {
  query = searchInput.value
  // 只有当输入内容确实「像」该工具要处理的数据时，才把它带进工具，避免把搜索词当成内容
  const toolEntries: Entry[] = ranked(query).map((tool) => ({
    kind: 'tool',
    tool,
    text: (tool.detect?.(query) ?? 0) > 0 ? query.trim() : '',
  }))
  const appEntries: Entry[] = rankApps(query).map((app) => ({ kind: 'app', app }))
  entries = [...toolEntries, ...appEntries]

  const total = entries.length + (clipboardHint && !query.trim() ? 1 : 0)
  activeIndex = Math.min(activeIndex, Math.max(0, total - 1))
  if (activeIndex < 0) activeIndex = 0
  renderList()
}

function move(step: number): void {
  const total = entries.length + (clipboardHint && !query.trim() ? 1 : 0)
  if (!total) return
  activeIndex = (activeIndex + step + total) % total
  renderList()
}

function activate(): void {
  if (clipboardHint && !query.trim()) {
    if (activeIndex === 0) {
      openTool(clipboardHint.tool, clipboardHint.text)
      return
    }
  }
  const offset = clipboardHint && !query.trim() ? 1 : 0
  const entry = entries[activeIndex - offset]
  if (!entry) return
  if (entry.kind === 'tool') openTool(entry.tool, entry.text)
  else void launchApp(entry.app)
}

/** 启动应用后关闭面板 */
async function launchApp(app: AppEntry): Promise<void> {
  try {
    await openApp(app.path)
    await hideWindow()
  } catch (error) {
    toast(`启动失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadApps(): Promise<void> {
  try {
    const list = await listApps()
    if (list.length) {
      apps = list
      refresh()
    }
  } catch (error) {
    console.error('读取应用列表失败', error)
  }
}

/* ------------------------------------------------------------------ *
 * 工具页
 * ------------------------------------------------------------------ */

function openTool(tool: ToolModule, initial: string): void {
  closeTool()
  currentTool = tool

  renderHeader({ icon: tool.icon, back: true, title: tool.name, sub: tool.desc })

  clear(footer)
  footer.appendChild(el('span', {}, el('span', { class: 'kbd' }, 'Esc'), ' 返回'))
  footer.appendChild(el('span', {}, el('span', { class: 'kbd' }, 'Ctrl'), ' + ', el('span', { class: 'kbd' }, '↵'), ' 部分工具可执行'))
  footer.appendChild(el('span', { class: 'footer-spacer' }))
  footer.appendChild(el('span', { class: 'footer-link', onclick: () => void hideWindow() }, '隐藏'))
  footer.appendChild(el('span', { class: 'footer-link', onclick: () => void quitApp() }, '退出'))

  clear(content)
  const root = el('div', { class: 'tool' })
  content.appendChild(root)
  disposeTool = tool.mount(root, initial)
}

function closeTool(): void {
  if (disposeTool) {
    try {
      disposeTool()
    } catch {
      /* 忽略清理异常 */
    }
    disposeTool = null
  }
  currentTool = null
}

function goHome(): void {
  if (!currentTool) return
  closeTool()
  clear(content)
  content.appendChild(listBox)
  renderHomeHeader()
  renderHomeFooter()
  refresh()
  searchInput.focus()
}

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */

searchInput.addEventListener('input', () => {
  activeIndex = 0
  refresh()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (currentTool) goHome()
    else void hideWindow()
    return
  }
  if (currentTool) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    activate()
  }
})

/** 读剪贴板，给出「直接处理剪贴板内容」的快捷入口 */
async function refreshClipboardHint(): Promise<void> {
  clipboardHint = null
  let text = ''
  try {
    text = (await readText()).trim()
  } catch {
    return
  }
  if (!text || text.length > 200_000) {
    refresh()
    return
  }
  let best: { tool: ToolModule; score: number } | null = null
  for (const tool of tools) {
    const score = tool.detect?.(text) ?? 0
    if (score >= 80 && (!best || score > best.score)) best = { tool, score }
  }
  if (best) clipboardHint = { tool: best.tool, text }
  refresh()
}

function resetView(): void {
  closeTool()
  clear(content)
  content.appendChild(listBox)
  renderHomeHeader()
  renderHomeFooter()
  searchInput.value = ''
  activeIndex = 0
  refresh()
  searchInput.focus()
}

onWindowShown(() => {
  resetView()
  void refreshClipboardHint()
  if (!apps.length) void loadApps()
})

applyOpacity(opacityPercent)
searchInput.focus()
resetView()
void refreshClipboardHint()
void loadApps()
