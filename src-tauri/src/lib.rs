use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

// ---------- HTTP 请求（curl 工具 / 公网 IP 查询共用） ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestPayload {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_ms: u64,
    insecure: bool,
    follow_redirects: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponsePayload {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
    elapsed_ms: u128,
    size: usize,
    url: String,
}

fn http_client(
    timeout: Duration,
    insecure: bool,
    follow_redirects: bool,
) -> Result<reqwest::Client, String> {
    let redirect = if follow_redirects {
        reqwest::redirect::Policy::default()
    } else {
        reqwest::redirect::Policy::none()
    };
    reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(insecure)
        .redirect(redirect)
        .user_agent(concat!("devkit/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    let client = http_client(
        Duration::from_millis(payload.timeout_ms.max(1)),
        payload.insecure,
        payload.follow_redirects,
    )?;
    let method = reqwest::Method::from_bytes(payload.method.to_uppercase().as_bytes())
        .map_err(|e| e.to_string())?;
    let mut req = client.request(method, &payload.url);
    for (k, v) in &payload.headers {
        if !k.trim().is_empty() {
            req = req.header(k.trim(), v.trim());
        }
    }
    if let Some(body) = payload.body {
        if !body.is_empty() {
            req = req.body(body);
        }
    }
    let started = Instant::now();
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let mut headers = Vec::new();
    for (k, v) in resp.headers() {
        if let Ok(vs) = v.to_str() {
            headers.push((k.as_str().to_string(), vs.to_string()));
        }
    }
    let url = resp.url().to_string();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponsePayload {
        status: status.as_u16(),
        status_text,
        headers,
        size: body.len(),
        body,
        elapsed_ms: started.elapsed().as_millis(),
        url,
    })
}

// ---------- 剪贴板 ----------

#[tauri::command]
fn set_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_clipboard() -> Result<String, String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.get_text())
        .map_err(|e| e.to_string())
}

// ---------- 窗口 ----------

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------- 应用列表（启动器） ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    name: String,
    path: String,
    kind: String,
}

pub struct AppState {
    apps: Mutex<Option<Vec<AppEntry>>>,
    icons: Mutex<HashMap<String, Option<String>>>,
}

#[tauri::command]
fn list_apps(state: State<AppState>) -> Vec<AppEntry> {
    let mut cached = state.apps.lock().unwrap();
    if cached.is_none() {
        *cached = Some(scan_apps());
    }
    cached.as_ref().cloned().unwrap_or_default()
}

#[cfg(windows)]
fn scan_apps() -> Vec<AppEntry> {
    let mut apps: Vec<AppEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // 1. 开始菜单快捷方式（全系统 + 当前用户）
    let mut stack: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(pd) = std::env::var("ProgramData") {
        stack.push(std::path::PathBuf::from(pd).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(ad) = std::env::var("AppData") {
        stack.push(std::path::PathBuf::from(ad).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if p.extension().map(|e| e.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
                let name = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if name.is_empty() || !seen.insert(name.clone()) {
                    continue;
                }
                let target = lnk::ShellLink::open(&p, encoding_rs::WINDOWS_1252)
                    .ok()
                    .and_then(|l| l.link_target())
                    .unwrap_or_default();
                let path = if target.trim().is_empty() {
                    p.to_string_lossy().into_owned()
                } else {
                    target
                };
                apps.push(AppEntry { name, path, kind: "shortcut".into() });
            }
        }
    }

    // 2. 注册表 App Paths
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let Ok(key) = winreg::RegKey::predef(root)
            .open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths")
        else {
            continue;
        };
        for sub in key.enum_keys().flatten() {
            let name = sub.trim_end_matches(".exe").to_string();
            if name.is_empty() || !seen.insert(name.clone()) {
                continue;
            }
            let path = key
                .open_subkey(&sub)
                .and_then(|k| k.get_value::<String, _>(""))
                .unwrap_or(sub.clone());
            apps.push(AppEntry { name, path, kind: "apppath".into() });
        }
    }

    // 3. PATH 目录下的 exe
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false) {
                    let name = p
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    if name.is_empty() || !seen.insert(name.clone()) {
                        continue;
                    }
                    apps.push(AppEntry {
                        name,
                        path: p.to_string_lossy().into_owned(),
                        kind: "exe".into(),
                    });
                }
            }
        }
    }
    apps
}

#[cfg(not(windows))]
fn scan_apps() -> Vec<AppEntry> {
    Vec::new()
}

#[tauri::command]
fn open_app(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        if path.to_ascii_lowercase().ends_with(".lnk") {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ---------- 本机网络信息 ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    name: String,
    description: String,
    kind: String,
    up: bool,
    mac: String,
    ipv4: Vec<String>,
    ipv6: Vec<String>,
    gateways: Vec<String>,
    dns: Vec<String>,
    mtu: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    hostname: String,
    username: String,
    os: String,
    primary_ip: String,
    mac: String,
    adapters: Vec<AdapterInfo>,
}

#[tauri::command]
fn local_network_info() -> NetworkInfo {
    let mut adapters = Vec::new();
    let mut primary_ip = String::new();
    let mut primary_mac = String::new();
    for it in netdev::get_interfaces() {
        let up = it.is_up() && !it.is_loopback();
        let ipv4: Vec<String> = it.ipv4.iter().map(|a| a.addr().to_string()).collect();
        let ipv6: Vec<String> = it.ipv6.iter().map(|a| a.addr().to_string()).collect();
        let mut gateways = Vec::new();
        if let Some(gw) = &it.gateway {
            for ip in &gw.ipv4 {
                gateways.push(ip.to_string());
            }
            for ip in &gw.ipv6 {
                gateways.push(ip.to_string());
            }
        }
        let dns: Vec<String> = it.dns_servers.iter().map(|d| d.to_string()).collect();
        if primary_ip.is_empty() && up && (it.default || !gateways.is_empty()) && !ipv4.is_empty() {
            primary_ip = ipv4[0].clone();
            primary_mac = it.mac_addr.map(|m| m.to_string()).unwrap_or_default();
        }
        adapters.push(AdapterInfo {
            description: it
                .friendly_name
                .clone()
                .or(it.description.clone())
                .unwrap_or_else(|| it.name.clone()),
            name: it.name.clone(),
            kind: format!("{:?}", it.if_type),
            up,
            mac: it.mac_addr.map(|m| m.to_string()).unwrap_or_default(),
            ipv4,
            ipv6,
            gateways,
            dns,
            mtu: it.mtu.unwrap_or(0),
        });
    }
    NetworkInfo {
        hostname: whoami::fallible::hostname().unwrap_or_default(),
        username: whoami::username(),
        os: whoami::distro(),
        primary_ip,
        mac: primary_mac,
        adapters,
    }
}

// ---------- 公网 IP（依次尝试多个服务） ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicIpInfo {
    ip: String,
    country: String,
    region: String,
    city: String,
    isp: String,
    source: String,
}

fn json_str(j: &serde_json::Value, key: &str) -> String {
    j.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

#[tauri::command]
async fn public_ip() -> Result<PublicIpInfo, String> {
    let client = http_client(Duration::from_secs(8), false, true)?;

    if let Ok(resp) = client
        .get("http://ip-api.com/json/?fields=query,country,regionName,city,isp")
        .send()
        .await
    {
        if let Ok(j) = resp.json::<serde_json::Value>().await {
            let ip = json_str(&j, "query");
            if !ip.is_empty() {
                return Ok(PublicIpInfo {
                    ip,
                    country: json_str(&j, "country"),
                    region: json_str(&j, "regionName"),
                    city: json_str(&j, "city"),
                    isp: json_str(&j, "isp"),
                    source: "ip-api.com".into(),
                });
            }
        }
    }

    if let Ok(resp) = client.get("https://ipinfo.io/json").send().await {
        if let Ok(j) = resp.json::<serde_json::Value>().await {
            let ip = json_str(&j, "ip");
            if !ip.is_empty() {
                return Ok(PublicIpInfo {
                    ip,
                    country: json_str(&j, "country"),
                    region: json_str(&j, "region"),
                    city: json_str(&j, "city"),
                    isp: json_str(&j, "org"),
                    source: "ipinfo.io".into(),
                });
            }
        }
    }

    if let Ok(resp) = client.get("https://api.ip.sb/geoip").send().await {
        if let Ok(j) = resp.json::<serde_json::Value>().await {
            let ip = json_str(&j, "ip");
            if !ip.is_empty() {
                return Ok(PublicIpInfo {
                    ip,
                    country: json_str(&j, "country"),
                    region: json_str(&j, "region"),
                    city: json_str(&j, "city"),
                    isp: json_str(&j, "organization"),
                    source: "ip.sb".into(),
                });
            }
        }
    }

    Err("所有公网 IP 查询服务均失败".into())
}

// ---------- 应用图标（PowerShell 抽取 exe 图标，转 PNG data URL，带缓存） ----------

#[tauri::command]
fn app_icon(path: String, state: State<AppState>) -> Option<String> {
    let mut cache = state.icons.lock().unwrap();
    if let Some(hit) = cache.get(&path) {
        return hit.clone();
    }
    let icon = extract_icon(&path);
    cache.insert(path, icon.clone());
    icon
}

#[cfg(windows)]
fn extract_icon(path: &str) -> Option<String> {
    let mut target = path.to_string();
    if target.to_ascii_lowercase().ends_with(".lnk") {
        target = lnk::ShellLink::open(path, encoding_rs::WINDOWS_1252)
            .ok()?
            .link_target()
            .filter(|s| !s.trim().is_empty())?;
    }
    if !target.to_ascii_lowercase().ends_with(".exe") || !std::path::Path::new(&target).exists() {
        return None;
    }

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    target.hash(&mut hasher);
    let out = std::env::temp_dir().join(format!("devkit-icon-{:016x}.png", hasher.finish()));
    if !out.exists() {
        let script = format!(
            "Add-Type -AssemblyName System.Drawing; \
             $i=[System.Drawing.Icon]::ExtractAssociatedIcon('{}'); \
             if($null -eq $i){{exit 1}}; \
             $i.ToBitmap().Save('{}',[System.Drawing.Imaging.ImageFormat]::Png)",
            target.replace('\'', "''"),
            out.to_string_lossy().replace('\'', "''"),
        );
        let ok = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .ok()?
            .status
            .success();
        if !ok {
            return None;
        }
    }
    let bytes = std::fs::read(&out).ok()?;
    use base64::Engine as _;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(not(windows))]
fn extract_icon(_path: &str) -> Option<String> {
    None
}

// ---------- 入口 ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            let focused = window.is_focused().unwrap_or(false);
                            if visible && focused {
                                let _ = window.hide();
                            } else {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = app.emit("window-shown", ());
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            app.global_shortcut().register("Alt+Space")?;
            Ok(())
        })
        .manage(AppState {
            apps: Mutex::new(None),
            icons: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            http_request,
            set_clipboard,
            get_clipboard,
            hide_window,
            list_apps,
            open_app,
            local_network_info,
            public_ip,
            app_icon,
            start_window_drag,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
