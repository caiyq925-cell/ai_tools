import { parseDocument, stringify } from 'yaml'
import { createCodeTool, sizeHint } from './code-tool'

function parseYaml(text: string) {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('请输入 YAML 内容')
  // 注意：keepSourceTokens 与 Document.toString() 不兼容，会导致格式化报错
  const doc = parseDocument(trimmed, { prettyErrors: true })
  const errors = doc.errors.filter((e) => !/unresolved tag/i.test(e.message))
  if (errors.length) {
    const first = errors[0]!
    const line = first.linePos?.[0]
    const where = line ? `\n位置：第 ${line.line} 行，第 ${line.col} 列` : ''
    throw new Error(`YAML 解析失败：${first.message}${where}`)
  }
  return doc
}

function looksLikeJson(text: string): boolean {
  const s = text.trim()
  if (!/^[[{]/.test(s)) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

export const yamlTool = createCodeTool({
  id: 'yaml',
  name: 'YAML 格式化',
  desc: 'YAML 美化 / JSON ⇄ YAML 互转，保留注释',
  icon: '⇅',
  keywords: ['yaml', 'yml', 'json', 'format', 'k8s', 'kubernetes', '格式化', '美化', '转换', '互转'],
  placeholder: '粘贴 YAML（或 JSON）内容…',
  sample:
    'server:\n  port: 8080\n  name: devkit\nspring:\n  datasource:\n    url: jdbc:mysql://127.0.0.1:3306/demo\n    username: root\nfeatures:\n  - time\n  - json\n  - curl',
  inputTitle: '输入',
  outputTitle: '结果',
  primaryLabel: '格式化',
  secondaryLabel: '转 JSON',

  detect(input) {
    const s = input.trim()
    if (!s || s.startsWith('<') || /^curl\s/i.test(s)) return 0
    if (/^[[{]/.test(s)) return 0
    if (s.includes(':')) {
      const lines = s.split('\n')
      const yamlLines = lines.filter((l) => /^\s*([-*]\s+|[^#\s][^:]*:(?!\/\/))/.test(l) || /^\s*$/.test(l) || /^\s*#/.test(l))
      if (yamlLines.length >= Math.max(1, lines.length * 0.6) && /:\s|:\s*$/m.test(s)) return 72
    }
    return 0
  },

  primary(ctx) {
    const raw = ctx.getInput()
    if (looksLikeJson(raw)) {
      const text = stringify(JSON.parse(raw.trim()), { indent: 2, lineWidth: 0 })
      ctx.setOutput(text)
      ctx.ok(`已由 JSON 转为 YAML · ${sizeHint(text)}`)
      return
    }
    const doc = parseYaml(raw)
    const text = doc.toString({ indent: 2, lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' })
    ctx.setOutput(text)
    ctx.ok(`格式化完成 · ${sizeHint(text)}`)
  },

  secondary(ctx) {
    const doc = parseYaml(ctx.getInput())
    const text = JSON.stringify(doc.toJS(), null, 2)
    ctx.setOutput(text)
    ctx.ok(`已转为 JSON · ${sizeHint(text)}`)
  },

  extraActions: [
    {
      label: '转 YAML',
      run(ctx) {
        const data = JSON.parse(ctx.getInput().trim())
        const text = stringify(data, { indent: 2, lineWidth: 0 })
        ctx.setOutput(text)
        ctx.ok(`已转为 YAML · ${sizeHint(text)}`)
      },
    },
    {
      label: '去注释',
      run(ctx) {
        const doc = parseYaml(ctx.getInput())
        doc.commentBefore = null
        doc.comment = null
        const strip = (node: unknown): void => {
          const item = node as { comment?: string | null; commentBefore?: string | null; items?: { key?: unknown; value?: unknown }[]; value?: unknown }
          if (!item || typeof item !== 'object') return
          item.comment = null
          item.commentBefore = null
          if (Array.isArray(item.items)) {
            for (const entry of item.items) {
              strip(entry.value)
              strip(entry.key)
            }
          }
          if (item.value) strip(item.value)
        }
        strip(doc.contents)
        const text = doc.toString({ indent: 2, lineWidth: 0 })
        ctx.setOutput(text)
        ctx.ok('已移除注释')
      },
    },
    {
      label: '压缩为行',
      run(ctx) {
        const doc = parseYaml(ctx.getInput())
        const text = JSON.stringify(doc.toJS())
        ctx.setOutput(text)
        ctx.ok(`已压缩为单行 JSON · ${text.length} 字符`)
      },
    },
  ],
})
