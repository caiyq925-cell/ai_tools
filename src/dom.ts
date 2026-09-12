type Props = Record<string, unknown>
export type Child = Node | string | number | null | undefined | false

/** 极简 DOM 构造器，避免引入前端框架 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue
      if (key === 'class') node.className = String(value)
      else if (key === 'text') node.textContent = String(value)
      else if (key === 'html') node.innerHTML = String(value)
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value as object)
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      } else if (value === true) node.setAttribute(key, '')
      else node.setAttribute(key, String(value))
    }
  }
  append(node, children)
  return node
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)))
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/** 生成一个带标题的区块 */
export function section(title: string, extra?: Child): { root: HTMLElement; body: HTMLElement } {
  const body = el('div', { class: 'section-body' })
  const root = el('section', { class: 'section' }, el('div', { class: 'section-head' }, el('h3', { text: title }), extra), body)
  return { root, body }
}

/** 按钮：variant = primary | ghost | danger */
export function button(label: string, onClick: () => void, variant = 'ghost'): HTMLButtonElement {
  return el('button', { class: `btn btn-${variant}`, type: 'button', onclick: onClick }, label)
}

export function copyButton(getText: () => string, label = '复制'): HTMLButtonElement {
  const btn = button(label, async () => {
    const text = getText()
    if (!text) return
    const { copyText } = await import('./bridge')
    await copyText(text)
    flash(btn, '已复制')
  })
  return btn
}

/** 按钮临时改文案再恢复，用于「已复制」反馈 */
export function flash(target: HTMLElement, text: string, ms = 1200): void {
  const original = target.textContent ?? ''
  target.textContent = text
  target.classList.add('flash')
  window.setTimeout(() => {
    target.textContent = original
    target.classList.remove('flash')
  }, ms)
}

export function textarea(placeholder: string, value = ''): HTMLTextAreaElement {
  const ta = el('textarea', { class: 'editor', placeholder, spellcheck: 'false' })
  ta.value = value
  return ta
}

/** Tab 键在 textarea 中插入两个空格而不是切换焦点 */
export function enableTabIndent(ta: HTMLTextAreaElement): void {
  ta.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent
    if (e.key !== 'Tab') return
    e.preventDefault()
    const { selectionStart: start, selectionEnd: end, value } = ta
    ta.value = value.slice(0, start) + '  ' + value.slice(end)
    ta.selectionStart = ta.selectionEnd = start + 2
  })
}

export function errorBar(): { root: HTMLElement; show: (msg: string) => void; hide: () => void } {
  const root = el('div', { class: 'notice notice-error hidden' })
  return {
    root,
    show(msg: string) {
      root.textContent = msg
      root.classList.remove('hidden')
    },
    hide() {
      root.classList.add('hidden')
    },
  }
}

export function infoBar(): { root: HTMLElement; show: (msg: string) => void; hide: () => void } {
  const root = el('div', { class: 'notice notice-info hidden' })
  return {
    root,
    show(msg: string) {
      root.textContent = msg
      root.classList.remove('hidden')
    },
    hide() {
      root.classList.add('hidden')
    },
  }
}

export function span(text: string, cls = ''): HTMLSpanElement {
  return el('span', { class: cls }, text)
}
