export interface ToolModule {
  id: string
  /** 命令面板中显示的名称 */
  name: string
  /** 一句话说明 */
  desc: string
  icon: string
  /** 用于搜索匹配的额外关键词 */
  keywords: string[]
  /**
   * 根据主输入框内容判断「这段文本像不像本工具要处理的东西」。
   * 返回 0 表示不匹配，数值越大越优先。
   */
  detect?: (input: string) => number
  /**
   * 渲染工具界面。
   * @param root 容器（已挂载到 DOM）
   * @param initial 从主输入框带过来的初始文本
   * @returns 清理函数（切换工具时调用）
   */
  mount(root: HTMLElement, initial: string): () => void
}
