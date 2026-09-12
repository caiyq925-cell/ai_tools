import { copyText } from '../bridge'
import { el, flash } from '../dom'
import type { ToolModule } from './types'

/* ------------------------------------------------------------------ *
 * 时区工具函数
 * ------------------------------------------------------------------ */

interface ZoneParts {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  second: string
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(timeZone, fmt)
  }
  return fmt
}

function zoneParts(date: Date, timeZone: string): ZoneParts {
  const out: Record<string, string> = {}
  for (const part of zoneFormatter(timeZone).formatToParts(date)) out[part.type] = part.value
  return {
    year: out.year ?? '1970',
    month: out.month ?? '01',
    day: out.day ?? '01',
    hour: out.hour ?? '00',
    minute: out.minute ?? '00',
    second: out.second ?? '00',
  }
}

function ms3(date: Date): string {
  return String(date.getUTCMilliseconds()).padStart(3, '0')
}

/** 指定时刻在该时区的偏移（分钟） */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = zoneParts(date, timeZone)
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  const flooredSeconds = Math.floor(date.getTime() / 1000) * 1000
  return Math.round((asUtc - flooredSeconds) / 60000)
}

function offsetText(date: Date, timeZone: string): string {
  const minutes = offsetMinutes(date, timeZone)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** 把「某时区的墙上时间」换算成绝对时刻 */
function fromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  const offset = offsetMinutes(new Date(guess), timeZone)
  return new Date(guess - offset * 60000)
}

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function fmtHuman(date: Date, timeZone: string): string {
  const p = zoneParts(date, timeZone)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${ms3(date)}`
}

function isoWithOffset(date: Date, timeZone: string): string {
  const p = zoneParts(date, timeZone)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms3(date)}${offsetText(date, timeZone)}`
}

function weekdayText(date: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }).format(date)
}

function relativeText(date: Date): string {
  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? '后' : '前'
  if (abs < 1000) return '刚刚'
  const units: [number, string][] = [
    [1000 * 60 * 60 * 24 * 365, '年'],
    [1000 * 60 * 60 * 24 * 30, '个月'],
    [1000 * 60 * 60 * 24 * 7, '周'],
    [1000 * 60 * 60 * 24, '天'],
    [1000 * 60 * 60, '小时'],
    [1000 * 60, '分钟'],
    [1000, '秒'],
  ]
  for (const [ms, unit] of units) {
    if (abs >= ms) return `${Math.floor(abs / ms)} ${unit}${suffix}`
  }
  return '刚刚'
}

function isoWeek(date: Date, timeZone: string): number {
  const p = zoneParts(date, timeZone)
  const target = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)))
  const dayNumber = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNumber + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3)
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
}

/* ------------------------------------------------------------------ *
 * 输入解析
 * ------------------------------------------------------------------ */

interface ParseResult {
  date: Date
  note: string
}

const DATE_RE =
  /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,3}))?)?(?:\s*(Z|z|[+-]\d{2}:?\d{2}))?$/

function parseInput(raw: string, timeZone: string): ParseResult {
  const text = raw.trim()
  if (!text || /^(now|now\(\)|当前时间|现在)$/i.test(text)) {
    return { date: new Date(), note: '当前时间' }
  }

  // 纯数字 → 时间戳，按位数推断单位
  if (/^-?\d+$/.test(text)) {
    const digits = text.replace('-', '')
    const value = Number(text)
    let ms: number
    let note: string
    if (digits.length <= 10) {
      ms = value * 1000
      note = '按秒解析'
    } else if (digits.length <= 13) {
      ms = value
      note = '按毫秒解析'
    } else if (digits.length <= 16) {
      ms = value / 1000
      note = '按微秒解析'
    } else {
      ms = value / 1_000_000
      note = '按纳秒解析'
    }
    // 8 位且以 19/20 开头，视为 YYYYMMDD
    if (digits.length === 8 && /^(19|20)\d{6}$/.test(digits)) {
      const p = { y: Number(text.slice(0, 4)), m: Number(text.slice(4, 6)), d: Number(text.slice(6, 8)) }
      return { date: fromZoned(p.y, p.m, p.d, 0, 0, 0, 0, timeZone), note: '按 YYYYMMDD 解析' }
    }
    return { date: new Date(ms), note }
  }

  const m = DATE_RE.exec(text)
  if (m) {
    const [, y, mo, d, h, mi, s, ms, tz] = m
    const nums = {
      y: Number(y),
      mo: Number(mo),
      d: Number(d),
      h: Number(h ?? 0),
      mi: Number(mi ?? 0),
      s: Number(s ?? 0),
      ms: Number((ms ?? '0').padEnd(3, '0')),
    }
    if (tz) {
      // 带时区标志，交给原生解析
      const iso = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T${String(nums.h).padStart(2, '0')}:${String(nums.mi).padStart(2, '0')}:${String(nums.s).padStart(2, '0')}.${String(nums.ms).padStart(3, '0')}${tz}`
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) throw new Error(`无法解析时间：${text}`)
      return { date, note: `按 ${tz} 时区解析` }
    }
    const date = fromZoned(nums.y, nums.mo, nums.d, nums.h, nums.mi, nums.s, nums.ms, timeZone)
    return { date, note: `按 ${timeZone} 时区解析` }
  }

  // 兜底：交给原生 Date（可解析 "Jan 1 2024" 等）
  const fallback = new Date(text)
  if (!Number.isNaN(fallback.getTime())) return { date: fallback, note: '原生 Date 解析' }

  throw new Error(`无法识别的时间格式：${text}`)
}

/* ------------------------------------------------------------------ *
 * 界面
 * ------------------------------------------------------------------ */

const ZONE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '本地时区' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (UTC+5:30)' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Chicago', label: 'America/Chicago' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' },
]

const COMPARE_ZONES = ['Asia/Shanghai', 'Asia/Tokyo', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles']

interface Row {
  label: string
  value: string
  group?: string
}

export const timeTool: ToolModule = {
  id: 'time',
  name: '时间转换',
  desc: '时间戳 ⇄ 日期时间，多时区、多格式互转',
  icon: '🕒',
  keywords: ['time', 'timestamp', 'date', 'unix', '时间', '时间戳', '日期', '时区', '转换'],

  detect(input) {
    const s = input.trim()
    if (!s) return 0
    if (/^\d{10}$|^\d{13}$|^\d{16}$|^\d{19}$/.test(s)) return 90
    if (/^(19|20)\d{6}$/.test(s)) return 84
    if (/^\d{1,13}$/.test(s)) return 55
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{1,2}(:\d{1,2})?)?(\.\d+)?$/.test(s)) return 82
    if (/^(now|现在|当前时间)$/i.test(s)) return 70
    return 0
  },

  mount(root, initial) {
    root.classList.add('tool')

    const zoneSelect = el('select', { class: 'input' })
    for (const option of ZONE_OPTIONS) {
      zoneSelect.appendChild(el('option', { value: option.value }, option.label))
    }
    zoneSelect.value = ''

    const input = el('input', { class: 'input', placeholder: '时间戳 / 日期字符串，例如 1735689600、2025-01-01 08:00:00', spellcheck: 'false' })
    input.value = initial

    const status = el('div', { class: 'status-line' })
    const rowsBox = el('div', { class: 'rows' })
    const errBox = el('div', { class: 'notice notice-error hidden' })

    const copyAll = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          const text = (rowsBox.querySelectorAll('.row') as NodeListOf<HTMLElement>)
          const lines: string[] = []
          text.forEach((row) => {
            const label = row.querySelector('.row-label')?.textContent ?? ''
            const value = row.querySelector('.row-value')?.textContent ?? ''
            lines.push(`${label}: ${value}`)
          })
          if (!lines.length) return
          await copyText(lines.join('\n'))
          flash(copyAll, '已复制全部')
        },
      },
      '复制全部',
    )

    const toolbar = el(
      'div',
      { class: 'toolbar' },
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(new Date()) }, '现在'),
      el('div', { class: 'field' }, el('label', { text: '输入时区' }), zoneSelect),
      el('div', { class: 'toolbar-spacer' }),
      copyAll,
    )

    root.appendChild(el('div', { class: 'tool-body' }, toolbar, el('div', { class: 'field' }, input), errBox, status, rowsBox))

    function currentZone(): string {
      return zoneSelect.value || localZone()
    }

    function addRow(row: Row): void {
      const value = el('div', { class: 'row-value', title: row.value }, row.value)
      const copy = el('button', { class: 'row-copy', type: 'button' }, '复制')
      copy.addEventListener('click', async (event) => {
        event.stopPropagation()
        await copyText(row.value)
        flash(copy, '✓')
      })
      const node = el(
        'div',
        {
          class: 'row',
          onclick: async () => {
            await copyText(row.value)
          },
        },
        el('div', { class: 'row-label', text: row.label }),
        value,
        copy,
      )
      rowsBox.appendChild(node)
    }

    function run(date: Date, note = ''): void {
      const zone = currentZone()
      const ms = date.getTime()
      const seconds = Math.floor(ms / 1000)

      status.textContent = ''
      status.appendChild(el('span', { class: 'pill pill-ok' }, note || '已解析'))
      status.appendChild(el('span', { class: 'pill' }, `时区 ${zone}`))
      status.appendChild(el('span', { class: 'pill' }, `偏移 ${offsetText(date, zone)}`))
      status.appendChild(el('span', { class: 'pill' }, relativeText(date)))

      while (rowsBox.firstChild) rowsBox.removeChild(rowsBox.firstChild)

      const stampRows: Row[] = [
        { label: '秒 (s)', value: String(seconds), group: '时间戳' },
        { label: '毫秒 (ms)', value: String(ms), group: '时间戳' },
        { label: '微秒 (µs)', value: `${ms}000`, group: '时间戳' },
        { label: '纳秒 (ns)', value: `${ms}000000`, group: '时间戳' },
      ]

      const formatRows: Row[] = [
        { label: '本地', value: fmtHuman(date, localZone()), group: '格式化' },
        { label: 'UTC', value: fmtHuman(date, 'UTC'), group: '格式化' },
        { label: 'ISO 8601 (UTC)', value: date.toISOString(), group: '格式化' },
        { label: 'ISO 8601 (本时区)', value: isoWithOffset(date, zone), group: '格式化' },
        { label: 'RFC 2822', value: date.toUTCString().replace('GMT', '+0000'), group: '格式化' },
        { label: '日期', value: `${fmtHuman(date, zone).slice(0, 10)}`, group: '格式化' },
        { label: '时间', value: `${fmtHuman(date, zone).slice(11, 19)}`, group: '格式化' },
      ]

      const calendarRows: Row[] = [
        { label: '星期', value: `${weekdayText(date, zone, 'zh-CN')} / ${weekdayText(date, zone, 'en-US')}`, group: '日历' },
        { label: 'ISO 周', value: `${zoneParts(date, zone).year} 年第 ${isoWeek(date, zone)} 周`, group: '日历' },
        { label: '季度', value: `Q${Math.floor((Number(zoneParts(date, zone).month) - 1) / 3) + 1}`, group: '日历' },
      ]

      const dayStart = fromZoned(
        Number(zoneParts(date, zone).year),
        Number(zoneParts(date, zone).month),
        Number(zoneParts(date, zone).day),
        0,
        0,
        0,
        0,
        zone,
      )
      const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1)
      calendarRows.push({
        label: '当日 00:00:00',
        value: `${Math.floor(dayStart.getTime() / 1000)}  /  ${dayStart.getTime()}`,
        group: '日历',
      })
      calendarRows.push({
        label: '当日 23:59:59',
        value: `${Math.floor(dayEnd.getTime() / 1000)}  /  ${dayEnd.getTime()}`,
        group: '日历',
      })

      const zoneRows: Row[] = COMPARE_ZONES.filter((z) => z !== zone).map((z) => ({
        label: z,
        value: `${fmtHuman(date, z)}  (${offsetText(date, z)})`,
        group: '时区对照',
      }))

      const all = [...stampRows, ...formatRows, ...calendarRows, ...zoneRows]
      let lastGroup = ''
      for (const row of all) {
        if (row.group !== lastGroup) {
          rowsBox.appendChild(el('div', { class: 'group-title', text: row.group ?? '' }))
          lastGroup = row.group ?? ''
        }
        addRow(row)
      }
    }

    function refresh(): void {
      errBox.classList.add('hidden')
      try {
        const { date, note } = parseInput(input.value, currentZone())
        run(date, note)
      } catch (e) {
        status.textContent = ''
        while (rowsBox.firstChild) rowsBox.removeChild(rowsBox.firstChild)
        errBox.textContent = e instanceof Error ? e.message : String(e)
        errBox.classList.remove('hidden')
      }
    }

    input.addEventListener('input', refresh)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') refresh()
    })
    zoneSelect.addEventListener('change', refresh)

    if (!input.value.trim()) input.value = String(Math.floor(Date.now() / 1000))
    refresh()
    input.focus()
    input.select()

    return () => {}
  },
}
