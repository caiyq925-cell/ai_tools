import { copyButton, el, enableTabIndent, textarea } from '../dom'
import type { ToolModule } from './types'

/* ------------------------------------------------------------------ *
 * MyBatis 日志解析
 * ------------------------------------------------------------------ */

interface Param {
  value: string
  type: string
  isNull: boolean
}

interface Statement {
  sql: string
  params: Param[]
  affected?: number
}

const NUMERIC_TYPES = new Set([
  'Integer',
  'Long',
  'Short',
  'Byte',
  'Double',
  'Float',
  'BigDecimal',
  'BigInteger',
  'Number',
  'AtomicInteger',
  'AtomicLong',
  'int',
  'long',
  'short',
  'byte',
  'double',
  'float',
])

const BOOLEAN_TYPES = new Set(['Boolean', 'boolean'])

function baseType(type: string): string {
  return type
    .replace(/^java\.(?:lang|math|util|sql|time|nio)\./, '')
    .replace(/\[\]$/, '')
    .trim()
}

/** MyBatis 打印的 `?` 与参数一一对应，这里负责还原可执行 SQL */
export function renderParam(param: Param, quoteStrings: boolean): string {
  if (param.isNull) return 'NULL'
  const value = param.value === '' ? '' : param.value
  if (param.type === '') return quoteStrings ? quote(value) : value
  const base = baseType(param.type)
  if (NUMERIC_TYPES.has(base) || BOOLEAN_TYPES.has(base)) return value
  return quoteStrings ? quote(value) : value
}

export function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** 把参数串拆成 { 值, 类型 } 列表，兼容值里含逗号 / 括号 / null 的情况 */
export function splitParams(text: string): Param[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const params: Param[] = []
  const re = /\(([^()]*)\)(?:\s*,\s*|$)/g
  let cursor = 0
  let match: RegExpExecArray | null
  let matched = false

  const emit = (raw: string, type: string): void => {
    const values = splitUntyped(raw)
    if (!values.length) {
      params.push({ value: '', type, isNull: false })
      return
    }
    for (let i = 0; i < values.length; i++) {
      const last = i === values.length - 1
      const value = values[i]!
      params.push(
        value === null ? { value: 'null', type: last ? type : '', isNull: true } : { value, type: last ? type : '', isNull: false },
      )
    }
  }

  while ((match = re.exec(trimmed)) !== null) {
    matched = true
    emit(trimmed.slice(cursor, match.index), match[1] ?? '')
    cursor = match.index + match[0].length
  }

  if (!matched) {
    // 完全没有类型信息，按逗号切分
    for (const part of trimmed.split(/\s*,\s*/)) params.push({ value: part, type: '', isNull: part.toLowerCase() === 'null' })
    return params
  }

  const tail = trimmed.slice(cursor).trim().replace(/^,\s*/, '')
  if (tail) emit(tail, '')
  return params
}

/** 拆出「值之前可能存在的无类型 null 参数」；返回 null 表示该位置是一个 null 参数 */
function splitUntyped(raw: string): (string | null)[] {
  let rest = raw.trim().replace(/^,\s*/, '')
  if (rest === '') return []
  const out: (string | null)[] = []
  for (;;) {
    if (rest === 'null') {
      out.push(null)
      return out
    }
    const m = /^null\s*,\s*([\s\S]*)$/.exec(rest)
    if (m) {
      out.push(null)
      rest = m[1]!.replace(/^\s*,\s*/, '')
      continue
    }
    out.push(rest)
    return out
  }
}

/** 跳过字符串字面量，避免把 SQL 里的 ? 误当占位符 */
export function inlineParams(sql: string, params: Param[], quoteStrings: boolean): { text: string; used: number } {
  let out = ''
  let index = 0
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      const quoteChar = ch
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === quoteChar) {
          if (sql[j + 1] === quoteChar) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      out += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      if (end === -1) {
        out += sql.slice(i)
        break
      }
      out += sql.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end === -1) {
        out += sql.slice(i)
        break
      }
      out += sql.slice(i, end + 2)
      i = end + 2
      continue
    }
    if (ch === '?') {
      const param = params[index]
      if (param) {
        out += renderParam(param, quoteStrings)
        index++
      } else {
        out += '?'
      }
      i++
      continue
    }
    out += ch
    i++
  }
  return { text: out, used: index }
}

const SQL_KEYWORD_RE =
  /\b(SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION(?:\s+ALL)?|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|(?:INNER|FULL|CROSS)\s+JOIN|JOIN|VALUES|SET|RETURNING|AND|OR|ON)\b/gi

const INDENT_KEYWORDS = new Set(['AND', 'OR', 'ON'])

/** 轻量 SQL 美化：关键字换行 + 按括号层级缩进 */
export function beautifySql(sql: string, upperCaseKeywords: boolean): string {
  const literals: string[] = []
  const masked = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`/g, (m) => {
    literals.push(m)
    return `\u0000${literals.length - 1}\u0000`
  })

  const parts: { text: string; isKeyword: boolean }[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  SQL_KEYWORD_RE.lastIndex = 0
  while ((match = SQL_KEYWORD_RE.exec(masked)) !== null) {
    if (match.index > cursor) parts.push({ text: masked.slice(cursor, match.index), isKeyword: false })
    parts.push({ text: match[0], isKeyword: true })
    cursor = match.index + match[0].length
  }
  parts.push({ text: masked.slice(cursor), isKeyword: false })

  let out = ''
  let depth = 0
  for (const part of parts) {
    if (!part.isKeyword) {
      out += part.text
      for (const ch of part.text) {
        if (ch === '(') depth++
        else if (ch === ')' && depth > 0) depth--
      }
      continue
    }
    const keyword = asKeyword(part.text, upperCaseKeywords)
    const key = keyword.toUpperCase().replace(/\s+/g, ' ')
    const indent = '  '.repeat(depth) + (INDENT_KEYWORDS.has(key) ? '  ' : '')
    out = out.replace(/[ \t]+$/, '')
    out += out.trim() === '' ? `${indent}${keyword}` : `\n${indent}${keyword}`
  }

  const restored = out.replace(/\u0000(\d+)\u0000/g, (_, n: string) => literals[Number(n)] ?? '')
  return restored.replace(/\n{3,}/g, '\n\n').trim()
}

function asKeyword(text: string, upper: boolean): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return upper ? normalized.toUpperCase() : normalized
}

/* ------------------------------------------------------------------ *
 * 日志扫描
 * ------------------------------------------------------------------ */

export interface ParseOptions {
  quoteStrings: boolean
  beautify: boolean
  upperCase: boolean
}

export interface ParseOutcome {
  statements: Statement[]
  unknownLines: number
  warnings: string[]
}

const PREPARING_RE = /^\s*(?:==>\s*)?Preparing:\s*(.*)$/i
const PARAMETERS_RE = /^\s*(?:==>\s*)?Parameters:\s*(.*)$/i
const TOTAL_RE = /^\s*(?:<==\s*)?(?:Total|Updates):\s*(\d+)/i
const COLUMNS_RE = /^\s*<==\s+Columns:/i
const ROW_RE = /^\s*<==\s+Row:/i

export function parseLog(text: string): ParseOutcome {
  const statements: Statement[] = []
  const warnings: string[] = []
  let unknownLines = 0
  let pending: Statement | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const preparing = PREPARING_RE.exec(line)
    if (preparing) {
      pending = { sql: preparing[1]!.trim(), params: [] }
      statements.push(pending)
      continue
    }

    const parameters = PARAMETERS_RE.exec(line)
    if (parameters) {
      const params = splitParams(parameters[1]!)
      if (pending) pending.params = params
      else if (statements.length) statements[statements.length - 1]!.params = params
      else {
        pending = { sql: '', params }
        statements.push(pending)
      }
      continue
    }

    const total = TOTAL_RE.exec(line)
    if (total) {
      if (pending) pending.affected = Number(total[1])
      else if (statements.length) statements[statements.length - 1]!.affected = Number(total[1])
      continue
    }

    if (COLUMNS_RE.test(line) || ROW_RE.test(line)) continue

    if (/^\s*<==/.test(line) || /^\s*==>/.test(line)) {
      unknownLines++
      continue
    }
    unknownLines++
  }

  const usable = statements.filter((s) => s.sql.trim().length > 0)
  if (!usable.length) {
    warnings.push('没有识别到 Preparing: 语句，请确认粘贴的是完整的 MyBatis 日志')
  }
  for (const s of usable) {
    const placeholders = countPlaceholders(s.sql)
    if (placeholders !== s.params.length) {
      warnings.push(`占位符数量(${placeholders})与参数数量(${s.params.length})不一致，请检查日志是否完整：\n${truncate(s.sql, 90)}`)
    }
  }
  return { statements: usable, unknownLines, warnings }
}

function countPlaceholders(sql: string): number {
  let count = 0
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      i = j + 1
      continue
    }
    if (ch === '?') count++
    i++
  }
  return count
}

function truncate(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').slice(0, max)
}

export function buildSql(outcome: ParseOutcome, options: ParseOptions): string {
  const blocks: string[] = []
  outcome.statements.forEach((statement, index) => {
    const { text, used } = inlineParams(statement.sql, statement.params, options.quoteStrings)
    const meta: string[] = [`#${index + 1}`]
    if (statement.affected !== undefined) meta.push(`影响行数 ${statement.affected}`)
    meta.push(used === statement.params.length ? `${used} 个参数` : `${used}/${statement.params.length} 个参数`)
    const sql = options.beautify ? beautifySql(text, options.upperCase) : text.trim()
    blocks.push(`-- ${meta.join(' · ')}\n${sql};`)
  })
  return blocks.join('\n\n')
}

/* ------------------------------------------------------------------ *
 * 界面
 * ------------------------------------------------------------------ */

const SAMPLE = `==>  Preparing: SELECT id, name, age, created_at FROM user WHERE id = ? AND name = ? AND status IN (?, ?)
==> Parameters: 1(Long), tom(String), 1(Integer), 2(Integer)
<==    Columns: id, name, age, created_at
<==        Row: 1, tom, 18, 2024-01-01 10:00:00
<==      Total: 1`

export const mybatisTool: ToolModule = {
  id: 'mybatis',
  name: 'MyBatis 日志转换',
  desc: '把 Preparing / Parameters 日志还原成可直接执行的 SQL',
  icon: '🛢',
  keywords: ['mybatis', 'sql', 'log', 'log4j', 'preparing', 'parameters', '日志', '转换', '还原', '占位符'],

  detect(input) {
    if (/Preparing:|Parameters:/.test(input)) return 96
    if (/\bTotal: \d+/.test(input) && /==>/.test(input)) return 60
    return 0
  },

  mount(root, initial) {
    root.classList.add('tool')

    const input = textarea('粘贴 MyBatis 日志，例如：\n==>  Preparing: SELECT * FROM user WHERE id = ?\n==> Parameters: 1(Long)', initial)
    input.classList.add('grow')
    enableTabIndent(input)

    const output = el('pre', { class: 'output grow' })
    const status = el('div', { class: 'status-line' })
    const errBox = el('div', { class: 'notice notice-error hidden' })
    const warnBox = el('div', { class: 'notice notice-info hidden' })

    const checkbox = (label: string, checked: boolean, onChange: () => void): { wrap: HTMLLabelElement; box: HTMLInputElement } => {
      const box = el('input', { type: 'checkbox' })
      box.checked = checked
      box.addEventListener('change', onChange)
      return { wrap: el('label', { class: 'check' }, box, label), box }
    }

    const run = (): void => {
      errBox.classList.add('hidden')
      warnBox.classList.add('hidden')
      status.textContent = ''
      output.textContent = ''
      try {
        const outcome = parseLog(input.value)
        if (!outcome.statements.length) {
          const message = outcome.warnings[0] ?? '未识别到可转换的日志'
          errBox.textContent = message
          errBox.classList.remove('hidden')
          return
        }
        const text = buildSql(outcome, { quoteStrings: quoteBox.box.checked, beautify: prettyBox.box.checked, upperCase: upperBox.box.checked })
        output.textContent = text
        const total = outcome.statements.reduce((sum, s) => sum + s.params.length, 0)
        status.appendChild(el('span', { class: 'pill pill-ok' }, `${outcome.statements.length} 条 SQL`))
        status.appendChild(el('span', { class: 'pill' }, `${total} 个参数`))
        const affected = outcome.statements.reduce((sum, s) => sum + (s.affected ?? 0), 0)
        if (affected) status.appendChild(el('span', { class: 'pill' }, `影响 ${affected} 行`))
        if (outcome.unknownLines) status.appendChild(el('span', { class: 'pill' }, `忽略 ${outcome.unknownLines} 行`))
        if (outcome.warnings.length) {
          warnBox.textContent = outcome.warnings.join('\n')
          warnBox.classList.remove('hidden')
        }
      } catch (e) {
        errBox.textContent = e instanceof Error ? e.message : String(e)
        errBox.classList.remove('hidden')
      }
    }

    const quoteBox = checkbox('字符串加引号', true, run)
    const prettyBox = checkbox('美化 SQL', true, run)
    const upperBox = checkbox('关键字大写', true, run)

    const toolbar = el(
      'div',
      { class: 'toolbar' },
      el('button', { class: 'btn btn-primary', type: 'button', onclick: run }, '转换'),
      quoteBox.wrap,
      prettyBox.wrap,
      upperBox.wrap,
      el('div', { class: 'toolbar-spacer' }),
      el('button', { class: 'btn', type: 'button', onclick: () => { input.value = SAMPLE; run(); input.focus() } }, '示例'),
      el('button', { class: 'btn', type: 'button', onclick: () => { input.value = ''; output.textContent = ''; status.textContent = ''; warnBox.classList.add('hidden'); errBox.classList.add('hidden'); input.focus() } }, '清空'),
    )

    root.appendChild(
      el(
        'div',
        { class: 'tool-body' },
        toolbar,
        errBox,
        warnBox,
        status,
        el(
          'div',
          { class: 'split' },
          el(
            'div',
            { class: 'col' },
            el('div', { class: 'col-head' }, el('span', { text: 'MyBatis 日志' }), el('div', { class: 'toolbar-spacer' }), copyButton(() => input.value, '复制日志')),
            input,
          ),
          el(
            'div',
            { class: 'col' },
            el('div', { class: 'col-head' }, el('span', { text: '可执行 SQL' }), el('div', { class: 'toolbar-spacer' }), copyButton(() => output.textContent ?? '', '复制 SQL')),
            output,
          ),
        ),
      ),
    )

    run()
    input.focus()
    return () => {}
  },
}
