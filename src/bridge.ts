/**
 * 与 Tauri 后端交互的桥接层。
 * 在浏览器中打开（vite dev）时自动降级为 Web API，方便纯前端调试。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface HttpRequestPayload {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
  timeoutMs: number
  insecure: boolean
  followRedirects: boolean
}

export interface HttpResponsePayload {
  status: number
  statusText: string
  headers: [string, string][]
  body: string
  elapsedMs: number
  size: number
  url: string
}

export async function httpRequest(payload: HttpRequestPayload): Promise<HttpResponsePayload> {
  if (isTauri) return invoke<HttpResponsePayload>('http_request', { payload })

  // 浏览器降级实现
  const started = performance.now()
  const init: RequestInit = {
    method: payload.method,
    headers: payload.headers,
  }
  if (payload.body) init.body = payload.body
  const resp = await fetch(payload.url, init)
  const text = await resp.text()
  const headers: [string, string][] = []
  resp.headers.forEach((value, key) => headers.push([key, value]))
  return {
    status: resp.status,
    statusText: resp.statusText,
    headers,
    body: text,
    elapsedMs: Math.round(performance.now() - started),
    size: new Blob([text]).size,
    url: resp.url,
  }
}

export async function copyText(text: string): Promise<void> {
  if (isTauri) return invoke('set_clipboard', { text })
  await navigator.clipboard.writeText(text)
}

export async function readText(): Promise<string> {
  if (isTauri) return invoke<string>('get_clipboard')
  return navigator.clipboard.readText()
}

export async function hideWindow(): Promise<void> {
  if (isTauri) await invoke('hide_window')
}

export interface AppEntry {
  name: string
  path: string
  kind: 'shortcut' | 'exe' | 'apppath'
}

/** 读取本机已安装应用列表（后端有缓存） */
export async function listApps(): Promise<AppEntry[]> {
  if (!isTauri) return []
  return invoke<AppEntry[]>('list_apps')
}

/** 启动指定应用 */
export async function openApp(path: string): Promise<void> {
  if (!isTauri) return
  await invoke('open_app', { path })
}

export interface AdapterInfo {
  name: string
  description: string
  kind: string
  up: boolean
  mac: string
  ipv4: string[]
  ipv6: string[]
  gateways: string[]
  dns: string[]
  mtu: number
}

export interface NetworkInfo {
  hostname: string
  username: string
  os: string
  primaryIp: string
  mac: string
  adapters: AdapterInfo[]
}

export interface PublicIpInfo {
  ip: string
  country: string
  region: string
  city: string
  isp: string
  source: string
}

/** 本机网卡信息（IP / MAC / 网关 / DNS） */
export async function localNetworkInfo(): Promise<NetworkInfo> {
  if (!isTauri) throw new Error('IP 查询仅在桌面应用中可用')
  return invoke<NetworkInfo>('local_network_info')
}

/** 公网出口 IP，会依次尝试多个公共服务 */
export async function publicIp(): Promise<PublicIpInfo> {
  if (!isTauri) throw new Error('IP 查询仅在桌面应用中可用')
  return invoke<PublicIpInfo>('public_ip')
}

/** 取应用真实图标的 PNG data URL；取不到返回 null */
export async function appIcon(path: string): Promise<string | null> {
  if (!isTauri) return null
  return invoke<string | null>('app_icon', { path })
}

/** 开始拖动窗口（由顶栏的 mousedown 触发） */
export async function startDragging(): Promise<void> {
  if (!isTauri) return
  await invoke('start_window_drag')
}

export async function quitApp(): Promise<void> {
  if (isTauri) await invoke('quit_app')
}

/** 后端每次唤起窗口都会广播该事件，用于重置界面并聚焦输入框 */
export function onWindowShown(handler: () => void): void {
  if (!isTauri) return
  void listen('window-shown', () => handler())
}

/** 读取剪贴板文本，失败时返回空串 */
export async function safeReadText(): Promise<string> {
  try {
    return await readText()
  } catch {
    return ''
  }
}
