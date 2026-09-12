import { httpRequest, type HttpResponsePayload } from '../bridge'
import { copyButton, el, textarea } from '../dom'
import type { ToolModule } from './types'

/* ------------------------------------------------------------------ *
 * curl 命令解析
 * ------------------------------------------------------------------ */

export interface CurlParsed {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
  insecure: boolean
  followRedirects: boolean
  warnings: string[]
}

/**
 * 预处理换行与续行符。
 * Edge/Chrome DevTools 的「Copy as cURL (cmd)」会用 CMD 转义：`^"` 表示引号、
 * `^` 结尾续行、`^\^"` 表示 `\"`，这里统一还原成普通写法。
 */
function normalize(input: string): string {
  let text = input.replace(/\r\n/g, '\n')
  const cmdStyle = /\^["']/.test(text) || /[ \t]\^\n/.test(text)
  if (cmdStyle) {
    // CMD 转义：^ 后跟任意字符都表示该字符本身
    text = text.replace(/\^([\s\S])/g, '$1')
  }
  return text
    .replace(/\\\n/g, ' ')
    .replace(/\n/g, ' ')
}

/** 支持单引号 / 双引号 / 反斜杠续行 / CMD 的 ^ 续行 */
export function tokenize(input: string): string[] {
  const normalized = normalize(input)

  const tokens: string[] = []
  let current = ''
  let quote: string | null = null

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!

    if (quote) {
      if (ch === '\\' && quote === '"') {
        const next = normalized[i + 1]
        if (next === 'n') {
          current += '\n'
          i++
          continue
        }
        if (next === 't') {
          current += '\t'
          i++
          continue
        }
        if (next === 'r') {
          current += '\r'
          i++
          continue
        }
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next
          i++
          continue
        }
      }
      if (ch === quote) {
        quote = null
        continue
      }
      current += ch
      continue
    }

    if ((ch === '$' || ch === "'") && normalized[i + 1] === "'") {
      // $'...' ANSI-C 引用
      quote = "'"
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

export function parseCurl(input: string): CurlParsed {
  const source = input.trim()
  if (!source) throw new Error('请输入 curl 命令或 URL')

  // 纯 URL 直接当作地址
  if (!/^curl\b/i.test(source) && /^(https?|wss?):\/\//i.test(source)) {
    return { method: 'GET', url: source, headers: [], body: null, insecure: false, followRedirects: true, warnings: [] }
  }

  const tokens = tokenize(source)
  if (!tokens.length) throw new Error('未能解析出任何参数')

  let url = ''
  let method = ''
  let body: string | null = null
  const headers: [string, string][] = []
  const formFields: [string, string][] = []
  const warnings: string[] = []
  let insecure = false
  let followRedirects = false

  const setHeader = (key: string, value: string): void => {
    const index = headers.findIndex(([k]) => k.toLowerCase() === key.toLowerCase())
    if (index >= 0) headers[index] = [key, value]
    else headers.push([key, value])
  }
  const hasHeader = (key: string): boolean => headers.some(([k]) => k.toLowerCase() === key.toLowerCase())

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (/^curl(\.exe)?$/i.test(token)) continue

    // 停止在管道 / 重定向 / 命令连接符处
    if (token === '|' || token === '>' || token === '>>' || token === '&&' || token === ';') break

    switch (token) {
      case '-X':
      case '--request':
        method = (tokens[++i] ?? 'GET').toUpperCase()
        break
      case '--url': {
        const value = tokens[++i] ?? ''
        if (!url) url = value
        break
      }
      case '-H':
      case '--header': {
        const value = tokens[++i] ?? ''
        const index = value.indexOf(':')
        if (index > 0) setHeader(value.slice(0, index).trim(), value.slice(index + 1).trim())
        break
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-ascii':
      case '--data-binary': {
        const value = tokens[++i] ?? ''
        body = body === null ? value : `${body}&${value}`
        break
      }
      case '--data-urlencode': {
        const value = tokens[++i] ?? ''
        const index = value.indexOf('=')
        const encoded = index >= 0 ? `${value.slice(0, index)}=${encodeURIComponent(value.slice(index + 1))}` : encodeURIComponent(value)
        body = body === null ? encoded : `${body}&${encoded}`
        break
      }
      case '--json': {
        const value = tokens[++i] ?? ''
        body = value
        if (!hasHeader('content-type')) setHeader('Content-Type', 'application/json')
        if (!hasHeader('accept')) setHeader('Accept', 'application/json')
        break
      }
      case '-F':
      case '--form': {
        const value = tokens[++i] ?? ''
        const index = value.indexOf('=')
        if (index > 0) {
          const key = value.slice(0, index)
          const val = value.slice(index + 1)
          if (val.startsWith('@') || val.startsWith('<')) warnings.push(`-F ${key} 引用了文件，已忽略文件内容`)
          formFields.push([key, val.startsWith('@') || val.startsWith('<') ? '' : val])
        }
        break
      }
      case '--form-string': {
        const value = tokens[++i] ?? ''
        const index = value.indexOf('=')
        if (index > 0) formFields.push([value.slice(0, index), value.slice(index + 1)])
        break
      }
      case '-u':
      case '--user': {
        const value = tokens[++i] ?? ''
        setHeader('Authorization', `Basic ${base64(value)}`)
        break
      }
      case '-b':
      case '--cookie': {
        setHeader('Cookie', tokens[++i] ?? '')
        break
      }
      case '-A':
      case '--user-agent': {
        setHeader('User-Agent', tokens[++i] ?? '')
        break
      }
      case '-e':
      case '--referer': {
        setHeader('Referer', tokens[++i] ?? '')
        break
      }
      case '-k':
      case '--insecure':
        insecure = true
        break
      case '-L':
      case '--location':
        followRedirects = true
        break
      case '-G':
      case '--get':
        method = 'GET'
        break
      case '-o':
      case '--output':
      case '-x':
      case '--proxy':
      case '--connect-timeout':
      case '-m':
      case '--max-time':
      case '--retry':
      case '--cacert':
      case '--cert':
      case '--key':
      case '-w':
      case '--write-out':
      case '-c':
      case '--cookie-jar':
      case '-D':
      case '--dump-header':
      case '--resolve':
      case '--interface':
      case '--retry-delay':
      case '--max-redirs':
        i++
        break
      default:
        if (token.startsWith('-')) break
        if (!url) url = token
    }
  }

  if (formFields.length) {
    if (!hasHeader('content-type')) setHeader('Content-Type', 'application/x-www-form-urlencoded')
    const encoded = formFields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    body = body === null ? encoded : `${body}&${encoded}`
  }

  if (!url) throw new Error('未在命令中找到请求地址（URL）')
  if (!method) method = body === null ? 'GET' : 'POST'

  return { method, url, headers, body, insecure, followRedirects, warnings }
}

/* ------------------------------------------------------------------ *
 * 界面
 * ------------------------------------------------------------------ */

const SAMPLE = `curl -X POST 'https://httpbin.org/post' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json' \\
  -d '{"name":"devkit","from":"alt+space"}'`

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function headersToText(headers: [string, string][]): string {
  return headers.map(([k, v]) => `${k}: ${v}`).join('\n')
}

function textToHeaders(text: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf(':')
    if (index <= 0) continue
    out.push([trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim()])
  }
  return out
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'pill pill-ok'
  if (status >= 300 && status < 400) return 'pill pill-warn'
  return 'pill pill-err'
}

export const curlTool: ToolModule = {
  id: 'curl',
  name: 'curl 调用',
  desc: '解析 curl 命令并直接发送请求，查看响应',
  icon: '🌐',
  keywords: ['curl', 'http', 'https', 'api', 'request', 'rest', 'post', 'get', '接口', '请求', '调用'],

  detect(input) {
    const s = input.trim()
    if (/^curl(\.exe)?\s/i.test(s) || /^\$?\s*curl\s/i.test(s)) return 92
    if (/^https?:\/\/\S+$/i.test(s)) return 45
    return 0
  },

  mount(root, initial) {
    root.classList.add('tool')

    const curlInput = textarea('粘贴 curl 命令，例如：curl -X POST https://example.com -H "Content-Type: application/json" -d \'{"a":1}\'', initial)
    curlInput.style.minHeight = '76px'

    const errBox = el('div', { class: 'notice notice-error hidden' })
    const infoBox = el('div', { class: 'notice notice-info hidden' })

    const methodSelect = el('select', { class: 'input' })
    for (const m of METHODS) methodSelect.appendChild(el('option', { value: m }, m))
    const urlInput = el('input', { class: 'input', placeholder: 'https://example.com/api', spellcheck: 'false' })
    const timeoutInput = el('input', { class: 'input', type: 'number', min: '1000', step: '1000', style: { maxWidth: '110px' } })
    timeoutInput.value = '30000'
    const insecureBox = el('input', { type: 'checkbox' })
    const redirectBox = el('input', { type: 'checkbox' })
    redirectBox.checked = true

    const headersInput = textarea('Content-Type: application/json')
    headersInput.style.minHeight = '84px'
    const bodyInput = textarea('请求体，仅 POST/PUT/PATCH 等需要')
    bodyInput.style.minHeight = '84px'

    const status = el('div', { class: 'status-line' })
    const responseBox = el('pre', { class: 'output grow' })
    const responseHeadBox = el('pre', { class: 'output grow hidden' })

    const tabBody = el('button', { class: 'tab active', type: 'button' }, '响应体')
    const tabHeaders = el('button', { class: 'tab', type: 'button' }, '响应头')
    tabBody.addEventListener('click', () => {
      tabBody.classList.add('active')
      tabHeaders.classList.remove('active')
      responseBox.classList.remove('hidden')
      responseHeadBox.classList.add('hidden')
    })
    tabHeaders.addEventListener('click', () => {
      tabHeaders.classList.add('active')
      tabBody.classList.remove('active')
      responseHeadBox.classList.remove('hidden')
      responseBox.classList.add('hidden')
    })

    let lastHeadersText = ''

    const showError = (message: string): void => {
      infoBox.classList.add('hidden')
      errBox.textContent = message
      errBox.classList.remove('hidden')
    }
    const showInfo = (message: string): void => {
      errBox.classList.add('hidden')
      infoBox.textContent = message
      infoBox.classList.remove('hidden')
    }

    const applyParsed = (): void => {
      errBox.classList.add('hidden')
      infoBox.classList.add('hidden')
      try {
        const parsed = parseCurl(curlInput.value)
        methodSelect.value = METHODS.includes(parsed.method) ? parsed.method : 'GET'
        urlInput.value = parsed.url
        headersInput.value = headersToText(parsed.headers)
        bodyInput.value = parsed.body ?? ''
        insecureBox.checked = parsed.insecure
        redirectBox.checked = parsed.followRedirects
        if (parsed.warnings.length) showInfo(parsed.warnings.join('\n'))
        else showInfo('解析完成，可直接发送或修改下方参数')
      } catch (e) {
        showError(e instanceof Error ? e.message : String(e))
      }
    }

    const send = async (): Promise<void> => {
      errBox.classList.add('hidden')
      infoBox.classList.add('hidden')
      status.textContent = ''
      responseBox.textContent = ''
      responseHeadBox.textContent = ''

      const url = urlInput.value.trim()
      if (!url) {
        showError('请求地址为空')
        return
      }
      if (!/^[a-zA-Z][\w+.-]*:\/\//.test(url)) {
        showError(`请求地址缺少协议前缀：${url}\n请补全 http:// 或 https://`)
        return
      }

      const method = methodSelect.value
      const hasBody = !['GET', 'HEAD'].includes(method)
      const body = hasBody && bodyInput.value.trim() ? bodyInput.value : null

      status.appendChild(el('span', { class: 'pill' }, el('span', { class: 'spin' }), ' 请求中…'))
      const spinner = status.querySelector('.spin')

      try {
        const response = await httpRequest({
          method,
          url,
          headers: textToHeaders(headersInput.value),
          body,
          timeoutMs: Math.max(1000, Number(timeoutInput.value) || 30000),
          insecure: insecureBox.checked,
          followRedirects: redirectBox.checked,
        })
        renderResponse(response)
      } catch (e) {
        spinner?.remove()
        showError(`请求失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }

    const renderResponse = (response: HttpResponsePayload): void => {
      status.textContent = ''
      status.appendChild(el('span', { class: statusClass(response.status) }, `${response.status} ${response.statusText}`.trim()))
      status.appendChild(el('span', { class: 'pill' }, `${response.elapsedMs} ms`))
      status.appendChild(el('span', { class: 'pill' }, humanSize(response.size)))
      const contentType = response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      if (contentType) status.appendChild(el('span', { class: 'pill' }, contentType.split(';')[0] ?? contentType))
      if (response.url && response.url !== urlInput.value.trim()) status.appendChild(el('span', { class: 'pill' }, `→ ${response.url}`))

      const isJson = /json/i.test(contentType ?? '') || /^\s*[[{]/.test(response.body)
      responseBox.textContent = isJson ? prettyJson(response.body) : response.body || '(空响应体)'
      lastHeadersText = response.headers.map(([k, v]) => `${k}: ${v}`).join('\n')
      responseHeadBox.textContent = lastHeadersText || '(无响应头)'
    }

    const sendBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => void send() }, '发送请求')

    const toolbar = el(
      'div',
      { class: 'toolbar' },
      el('button', { class: 'btn', type: 'button', onclick: applyParsed }, '解析 curl'),
      sendBtn,
      el('div', { class: 'toolbar-spacer' }),
      el('button', { class: 'btn', type: 'button', onclick: () => { curlInput.value = SAMPLE; applyParsed(); curlInput.focus() } }, '示例'),
      el('button', { class: 'btn', type: 'button', onclick: () => { curlInput.value = ''; urlInput.value = ''; headersInput.value = ''; bodyInput.value = ''; curlInput.focus() } }, '清空'),
    )

    const requestPane = el(
      'div',
      { class: 'col' },
      el('div', { class: 'col-head' }, el('span', { text: '请求' })),
      el('div', { class: 'field' }, methodSelect, urlInput),
      el(
        'div',
        { class: 'field' },
        el('label', { text: '超时(ms)' }),
        timeoutInput,
        el('label', { class: 'check' }, insecureBox, '忽略证书'),
        el('label', { class: 'check' }, redirectBox, '跟随重定向'),
      ),
      el('div', { class: 'col-head' }, el('span', { text: 'Headers' }), el('div', { class: 'toolbar-spacer' }), el('button', { class: 'btn', type: 'button', style: { padding: '3px 8px', fontSize: '11px' }, onclick: () => { headersInput.value = 'Content-Type: application/json' } }, '+ JSON')),
      headersInput,
      el('div', { class: 'col-head' }, el('span', { text: 'Body' }), el('div', { class: 'toolbar-spacer' }), el('button', { class: 'btn', type: 'button', style: { padding: '3px 8px', fontSize: '11px' }, onclick: () => { bodyInput.value = prettyJson(bodyInput.value) } }, '美化')),
      bodyInput,
    )

    const copyResp = copyButton(() => (tabBody.classList.contains('active') ? (responseBox.textContent ?? '') : lastHeadersText), '复制')
    const responsePane = el(
      'div',
      { class: 'col' },
      el('div', { class: 'col-head' }, el('span', { text: '响应' }), el('div', { class: 'toolbar-spacer' }), copyResp),
      status,
      el('div', { class: 'tabs' }, tabBody, tabHeaders),
      responseBox,
      responseHeadBox,
    )

    root.appendChild(
      el(
        'div',
        { class: 'tool-body' },
        el('div', { class: 'col-head' }, el('span', { text: 'curl 命令' }), el('div', { class: 'toolbar-spacer' }), copyButton(() => curlInput.value, '复制')),
        curlInput,
        toolbar,
        errBox,
        infoBox,
        el('div', { class: 'split' }, requestPane, responsePane),
      ),
    )

    curlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        applyParsed()
        void send()
      }
    })
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        void send()
      }
    })

    if (initial.trim()) applyParsed()
    curlInput.focus()

    return () => {}
  },
}
