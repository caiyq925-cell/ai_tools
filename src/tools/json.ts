import { createCodeTool, sizeHint } from './code-tool'

export function parseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('请输入 JSON 内容')
  try {
    return JSON.parse(trimmed)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const pos = /position (\d+)/.exec(message)
    if (pos?.[1]) {
      const index = Number(pos[1])
      const before = trimmed.slice(0, index)
      const line = before.split('\n').length
      const col = index - before.lastIndexOf('\n')
      const clean = message.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '')
      throw new Error(`JSON 解析失败：${clean}\n位置：第 ${line} 行，第 ${col} 列`)
    }
    throw new Error(`JSON 解析失败：${message}`)
  }
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) result[key] = sortDeep(source[key])
    return result
  }
  return value
}

export const jsonTool = createCodeTool({
  id: 'json',
  name: 'JSON 格式化',
  desc: '格式化 / 压缩 / 转义 / 排序键，自动定位语法错误',
  icon: '{}',
  keywords: ['json', 'format', 'beautify', 'minify', '格式化', '压缩', '美化', '转义', '排序'],
  placeholder: '粘贴 JSON 内容…',
  sample: '{"name":"devkit","version":"0.1.0","tags":["json","xml","yaml"],"config":{"port":1420,"debug":false}}',
  inputTitle: '输入 JSON',
  outputTitle: '结果',
  primaryLabel: '格式化',
  secondaryLabel: '压缩',

  detect(input) {
    const s = input.trim()
    if (!/^[[{]/.test(s)) return 0
    try {
      JSON.parse(s)
      return 95
    } catch {
      return /^[[{]/.test(s) ? 35 : 0
    }
  },

  primary(ctx) {
    const data = parseJson(ctx.getInput())
    const text = JSON.stringify(data, null, 2)
    ctx.setOutput(text)
    ctx.ok(`格式化完成 · ${sizeHint(text)}`)
  },

  secondary(ctx) {
    const data = parseJson(ctx.getInput())
    const text = JSON.stringify(data)
    ctx.setOutput(text)
    ctx.ok(`压缩完成 · ${text.length} 字符`)
  },

  extraActions: [
    {
      label: '排序键',
      run(ctx) {
        const data = parseJson(ctx.getInput())
        const text = JSON.stringify(sortDeep(data), null, 2)
        ctx.setOutput(text)
        ctx.ok('已按 key 递归排序')
      },
    },
    {
      label: '转义',
      run(ctx) {
        const raw = ctx.getInput().trim()
        if (!raw) throw new Error('请输入内容')
        const text = JSON.stringify(raw)
        ctx.setOutput(text)
        ctx.ok('已转义为 JSON 字符串字面量')
      },
    },
    {
      label: '去转义',
      run(ctx) {
        const raw = ctx.getInput().trim()
        if (!(raw.startsWith('"') && raw.endsWith('"'))) {
          throw new Error('输入不是以双引号包裹的字符串字面量')
        }
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'string') throw new Error('去转义结果不是字符串')
        ctx.setOutput(parsed)
        ctx.ok(`已去转义 · ${sizeHint(parsed)}`)
      },
    },
    {
      label: '查路径',
      run(ctx) {
        const data = parseJson(ctx.getInput())
        const lines: string[] = []
        walk(data, '$', lines, 0)
        const text = lines.join('\n') || '$ (空)'
        ctx.setOutput(text)
        ctx.ok(`共 ${lines.length} 个叶子节点`)
      },
    },
  ],
})

function walk(value: unknown, path: string, out: string[], depth: number): void {
  if (depth > 12) return
  if (Array.isArray(value)) {
    if (!value.length) {
      out.push(`${path} = []`)
      return
    }
    value.forEach((item, index) => walk(item, `${path}[${index}]`, out, depth + 1))
    return
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    if (!keys.length) {
      out.push(`${path} = {}`)
      return
    }
    for (const key of keys) {
      const safe = /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `["${key}"]`
      walk((value as Record<string, unknown>)[key], `${path}${safe}`, out, depth + 1)
    }
    return
  }
  out.push(`${path} = ${JSON.stringify(value)}`)
}
