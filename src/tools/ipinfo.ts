import { copyText, localNetworkInfo, publicIp, type NetworkInfo, type PublicIpInfo } from '../bridge'
import { clear, el, flash } from '../dom'
import type { ToolModule } from './types'

interface Row {
  label: string
  value: string
  group?: string
}

export const ipInfoTool: ToolModule = {
  id: 'ipinfo',
  name: 'IP 查询',
  desc: '公网出口 IP、内网 IP、MAC 地址、网关与 DNS',
  icon: '📡',
  keywords: ['ip', 'ipinfo', 'network', 'mac', 'dns', 'gateway', '网卡', '公网', '内网', '局域网', '出口', 'mac地址'],

  mount(root, initial) {
    root.classList.add('tool')

    const status = el('div', { class: 'status-line' })
    const rowsBox = el('div', { class: 'rows' })
    const errBox = el('div', { class: 'notice notice-error hidden' })

    let info: NetworkInfo | null = null
    let publicInfo: PublicIpInfo | null = null
    let publicError = ''
    let loadingPublic = true

    const refreshBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => void load() }, '刷新')

    /* ---------- 渲染 ---------- */

    function addRow(row: Row): void {
      const copy = el('button', { class: 'row-copy', type: 'button' }, '复制')
      copy.addEventListener('click', async (event) => {
        event.stopPropagation()
        await copyText(row.value)
        flash(copy, '✓')
      })
      rowsBox.appendChild(
        el(
          'div',
          { class: 'row', onclick: () => void copyText(row.value) },
          el('div', { class: 'row-label', text: row.label }),
          el('div', { class: 'row-value', title: row.value }, row.value),
          copy,
        ),
      )
    }

    function collectRows(): Row[] {
      const rows: Row[] = []

      // 公网出口
      if (loadingPublic) {
        rows.push({ label: '公网 IP', value: '查询中…', group: '公网出口' })
      } else if (publicInfo) {
        const place = [publicInfo.country, publicInfo.region, publicInfo.city].filter(Boolean).join(' ')
        rows.push({ label: '公网 IP', value: publicInfo.ip, group: '公网出口' })
        if (place) rows.push({ label: '归属地', value: place, group: '公网出口' })
        if (publicInfo.isp) rows.push({ label: '运营商', value: publicInfo.isp, group: '公网出口' })
        rows.push({ label: '查询来源', value: publicInfo.source, group: '公网出口' })
      } else {
        rows.push({ label: '公网 IP', value: publicError || '查询失败', group: '公网出口' })
      }

      // 本机概况
      if (info) {
        if (info.primaryIp) rows.push({ label: '内网 IP', value: info.primaryIp, group: '本机' })
        if (info.mac) rows.push({ label: 'MAC 地址', value: info.mac, group: '本机' })
        rows.push({ label: '主机名', value: info.hostname, group: '本机' })
        rows.push({ label: '用户名', value: info.username, group: '本机' })
        rows.push({ label: '操作系统', value: info.os, group: '本机' })
      }

      // 每张网卡
      for (const adapter of info?.adapters ?? []) {
        const group = `${adapter.name} · ${adapter.kind} · ${adapter.up ? '已连接' : '未连接'}`
        if (adapter.description) rows.push({ label: '设备', value: adapter.description, group })
        for (const ip of adapter.ipv4) rows.push({ label: 'IPv4', value: ip, group })
        for (const ip of adapter.ipv6) rows.push({ label: 'IPv6', value: ip, group })
        if (adapter.mac) rows.push({ label: 'MAC', value: adapter.mac, group })
        for (const gateway of adapter.gateways) rows.push({ label: '网关', value: gateway, group })
        for (const dns of adapter.dns) rows.push({ label: 'DNS', value: dns, group })
      }

      return rows
    }

    function render(): void {
      clear(rowsBox)
      const rows = collectRows()
      let lastGroup = ''
      for (const row of rows) {
        if (row.group !== lastGroup) {
          rowsBox.appendChild(el('div', { class: 'group-title', text: row.group ?? '' }))
          lastGroup = row.group ?? ''
        }
        addRow(row)
      }
    }

    function renderStatus(): void {
      clear(status)
      if (loadingPublic) {
        status.appendChild(el('span', { class: 'pill' }, el('span', { class: 'spin' }), ' 查询公网出口…'))
      } else if (publicInfo) {
        status.appendChild(el('span', { class: 'pill pill-ok' }, '公网出口已获取'))
      } else {
        status.appendChild(el('span', { class: 'pill pill-warn' }, '公网出口查询失败'))
      }
      if (info) {
        status.appendChild(el('span', { class: 'pill' }, `${info.adapters.length} 张网卡`))
      }
    }

    const copyAll = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          const lines = collectRows().map((row) => `${row.label}: ${row.value}`)
          if (!lines.length) return
          await copyText(lines.join('\n'))
          flash(copyAll, '已复制全部')
        },
      },
      '复制全部',
    )

    /* ---------- 数据 ---------- */

    async function load(): Promise<void> {
      errBox.classList.add('hidden')
      loadingPublic = true
      publicInfo = null
      publicError = ''
      render()
      renderStatus()

      try {
        info = await localNetworkInfo()
      } catch (error) {
        errBox.textContent = error instanceof Error ? error.message : String(error)
        errBox.classList.remove('hidden')
      }
      render()
      renderStatus()

      try {
        publicInfo = await publicIp()
      } catch (error) {
        publicError = error instanceof Error ? error.message.split('\n')[0]! : String(error)
      } finally {
        loadingPublic = false
        render()
        renderStatus()
      }
    }

    root.appendChild(
      el(
        'div',
        { class: 'tool-body' },
        el(
          'div',
          { class: 'toolbar' },
          refreshBtn,
          el('span', { class: 'footer-hint' }, '公网 IP 来自第三方服务，内网信息完全本地读取'),
          el('div', { class: 'toolbar-spacer' }),
          copyAll,
        ),
        errBox,
        status,
        rowsBox,
      ),
    )

    void load()
    void initial
    return () => {}
  },
}
