import { copyButton, el, enableTabIndent, errorBar, infoBar, textarea } from '../dom'
import type { ToolModule } from './types'

export interface CodeToolContext {
  getInput(): string
  setInput(value: string): void
  getOutput(): string
  setOutput(value: string): void
  /** 成功提示（绿色） */
  ok(message: string): void
  /** 普通提示（蓝色） */
  info(message: string): void
}

export interface CodeToolAction {
  label: string
  run(ctx: CodeToolContext): void
  variant?: 'ghost' | 'primary' | 'accent'
}

export interface CodeToolConfig {
  id: string
  name: string
  desc: string
  icon: string
  keywords: string[]
  detect?: (input: string) => number
  placeholder: string
  sample: string
  primaryLabel?: string
  secondaryLabel?: string
  primary(ctx: CodeToolContext): void
  secondary?(ctx: CodeToolContext): void
  extraActions?: CodeToolAction[]
  inputTitle?: string
  outputTitle?: string
}

/** 「左输入 / 右输出」这种通用文本工具的统一外壳 */
export function createCodeTool(config: CodeToolConfig): ToolModule {
  return {
    id: config.id,
    name: config.name,
    desc: config.desc,
    icon: config.icon,
    keywords: config.keywords,
    detect: config.detect,
    mount(root, initial) {
      root.classList.add('tool')

      const input = textarea(config.placeholder, initial)
      input.classList.add('grow')
      enableTabIndent(input)

      const output = el('pre', { class: 'output grow' })

      const err = errorBar()
      const info = infoBar()

      const ctx: CodeToolContext = {
        getInput: () => input.value,
        setInput: (value) => {
          input.value = value
        },
        getOutput: () => output.textContent ?? '',
        setOutput: (value) => {
          output.textContent = value
        },
        ok: (message) => {
          err.hide()
          info.root.className = 'notice notice-ok'
          info.show(message)
        },
        info: (message) => {
          err.hide()
          info.root.className = 'notice notice-info'
          info.show(message)
        },
      }

      const run = (fn: () => void) => () => {
        info.hide()
        err.hide()
        output.textContent = ''
        try {
          fn()
        } catch (e) {
          err.show(e instanceof Error ? e.message : String(e))
        }
      }

      const toolbar = el('div', { class: 'toolbar' })

      if (config.primary) {
        toolbar.appendChild(el('button', { class: 'btn btn-primary', type: 'button', onclick: run(() => config.primary(ctx)) }, config.primaryLabel ?? '格式化'))
      }
      if (config.secondary) {
        toolbar.appendChild(el('button', { class: 'btn', type: 'button', onclick: run(() => config.secondary!(ctx)) }, config.secondaryLabel ?? '压缩'))
      }
      for (const action of config.extraActions ?? []) {
        toolbar.appendChild(el('button', { class: `btn${action.variant === 'accent' ? ' btn-accent' : ''}`, type: 'button', onclick: run(() => action.run(ctx)) }, action.label))
      }

      toolbar.appendChild(el('div', { class: 'toolbar-spacer' }))
      toolbar.appendChild(
        el('button', { class: 'btn', type: 'button', onclick: () => { info.hide(); err.hide(); input.value = config.sample; input.focus() } }, '示例'),
      )
      const clearBtn = el('button', { class: 'btn', type: 'button', onclick: () => { input.value = ''; output.textContent = ''; info.hide(); err.hide(); input.focus() } }, '清空')
      toolbar.appendChild(clearBtn)

      const leftHead = el('div', { class: 'col-head' }, el('span', { text: config.inputTitle ?? '输入' }), el('div', { class: 'toolbar-spacer' }), copyButton(() => input.value, '复制输入'))
      const rightHead = el(
        'div',
        { class: 'col-head' },
        el('span', { text: config.outputTitle ?? '结果' }),
        el('div', { class: 'toolbar-spacer' }),
        copyButton(() => output.textContent ?? '', '复制结果'),
      )

      root.appendChild(
        el(
          'div',
          { class: 'tool-body' },
          toolbar,
          err.root,
          info.root,
          el(
            'div',
            { class: 'split' },
            el('div', { class: 'col' }, leftHead, input),
            el('div', { class: 'col' }, rightHead, output),
          ),
        ),
      )

      // 从主输入框带入内容时自动执行一次
      if (initial.trim() && config.primary) run(() => config.primary(ctx))()

      input.focus()

      return () => {
        info.hide()
        err.hide()
      }
    },
  }
}

/** 统计字符 / 行数，用于提示信息 */
export function sizeHint(text: string): string {
  const lines = text.split('\n').length
  return `${lines} 行 / ${text.length} 字符`
}
