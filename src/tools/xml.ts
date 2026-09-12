import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import { createCodeTool, sizeHint } from './code-tool'

const COMMON = {
  ignoreAttributes: false,
  preserveOrder: true as const,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  attributeNamePrefix: '@_',
  commentPropName: '#comment',
  cdataPropName: '#cdata',
}

const parser = new XMLParser(COMMON)

const prettyBuilder = new XMLBuilder({
  ...COMMON,
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
})

const compactBuilder = new XMLBuilder({
  ...COMMON,
  format: false,
  suppressEmptyNode: true,
})

function validate(text: string): void {
  const result = XMLValidator.validate(text)
  if (result !== true) {
    const err = result.err
    throw new Error(`XML 不合法：${err.msg}\n位置：第 ${err.line} 行，第 ${err.col} 列`)
  }
}

function toTree(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('请输入 XML 内容')
  validate(trimmed)
  const tree = parser.parse(trimmed)
  if (!Array.isArray(tree) || tree.length === 0) throw new Error('未解析出任何 XML 节点')
  return tree
}

function stringify(tree: unknown, pretty: boolean): string {
  const text = pretty ? prettyBuilder.build(tree) : compactBuilder.build(tree)
  const out = String(text).trim()
  // 修正 builder 在多根节点时产生的缩进偏移
  return pretty ? out.replace(/^\n+/, '') : out
}

export const xmlTool = createCodeTool({
  id: 'xml',
  name: 'XML 格式化',
  desc: '格式化 / 压缩 XML，带合法性校验与错误定位',
  icon: '<>',
  keywords: ['xml', 'format', 'beautify', 'minify', 'html', 'svg', 'pom', '格式化', '美化', '压缩'],
  placeholder: '粘贴 XML 内容…',
  sample:
    '<?xml version="1.0" encoding="UTF-8"?><project><modelVersion>4.0.0</modelVersion><groupId>com.demo</groupId><artifactId>app</artifactId><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.1.0</version></dependency></dependencies></project>',
  inputTitle: '输入 XML',
  outputTitle: '结果',
  primaryLabel: '格式化',
  secondaryLabel: '压缩',

  detect(input) {
    const s = input.trim()
    if (!s.startsWith('<')) return 0
    if (/^<\?xml|<[A-Za-z_][\w.:-]*(\s[^<>]*)?>/.test(s)) return 90
    return 25
  },

  primary(ctx) {
    const text = stringify(toTree(ctx.getInput()), true)
    ctx.setOutput(text)
    ctx.ok(`格式化完成 · ${sizeHint(text)}`)
  },

  secondary(ctx) {
    const text = stringify(toTree(ctx.getInput()), false)
    ctx.setOutput(text)
    ctx.ok(`压缩完成 · ${text.length} 字符`)
  },

  extraActions: [
    {
      label: '转义',
      run(ctx) {
        const raw = ctx.getInput().trim()
        if (!raw) throw new Error('请输入内容')
        const text = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        ctx.setOutput(text)
        ctx.ok('已转义 XML 特殊字符')
      },
    },
    {
      label: '去转义',
      run(ctx) {
        const raw = ctx.getInput().trim()
        if (!raw) throw new Error('请输入内容')
        const text = raw
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
        ctx.setOutput(text)
        ctx.ok('已反转义 XML 实体')
      },
    },
    {
      label: '转 JSON',
      run(ctx) {
        const trimmed = ctx.getInput().trim()
        validate(trimmed)
        const data = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: true, trimValues: true }).parse(trimmed)
        const text = JSON.stringify(data, null, 2)
        ctx.setOutput(text)
        ctx.ok('已转为 JSON')
      },
    },
  ],
})
