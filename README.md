# DevKit · Alt+Space 开发者工具箱

一个常驻后台的桌面小工具，按 <kbd>Alt</kbd> + <kbd>Space</kbd> 随时唤起，输入内容即自动识别该用哪个功能。

基于 **Tauri v2 + Vite + TypeScript**，安装包体积小、启动快，界面为 Spotlight 风格的悬浮命令面板。

## 功能

| 功能 | 说明 |
| --- | --- |
| 🕒 时间转换 | 时间戳（秒/毫秒/微秒/纳秒）⇄ 日期时间互转，输出本地/UTC/ISO 8601/RFC 2822、时区对照、相对时间、ISO 周、当日首尾时间戳 |
| {} JSON 格式化 | 美化 / 压缩 / 转义 / 去转义 / 递归排序键 / 列出所有 JSONPath，语法错误自动定位到行列 |
| <> XML 格式化 | 美化 / 压缩 / 实体转义 / 转 JSON，带合法性校验和行列错误定位 |
| ⇅ YAML 格式化 | 美化（保留注释）/ 转 JSON / JSON 转 YAML / 去注释 / 压缩为单行 |
| 🌐 curl 调用 | 粘贴 curl 命令自动解析出方法、URL、Headers、Body、Basic Auth，直接发送并查看响应（状态码、耗时、大小、响应体/响应头） |
| 📡 IP 查询 | 公网出口 IP（含归属地/运营商）、内网 IP、MAC 地址、网关、DNS、网卡型号与状态、主机名；所有条目点击即复制 |
| 🛢 MyBatis 日志转换 | 把 `==> Preparing:` / `==> Parameters:` 日志还原成可直接执行的 SQL，支持多语句、`null` 参数、逗号/括号值，可选 SQL 美化与关键字大写 |
| 🚀 应用启动 | 主输入框直接输入应用名（如「微信」「vscode」「idea」），回车即可启动本机应用，启动后自动收起面板；条目显示应用**真实图标** |

### 智能识别

主输入框不需要先选功能，直接粘贴内容即可，工具会按内容自动排序：

- 粘一个 10/13 位数字 → 时间转换
- 粘一段 JSON → JSON 格式化
- 粘一段 `<xml>` → XML 格式化
- 粘一段 `curl ...` → curl 调用
- 粘一段 `Preparing: ... Parameters: ...` → MyBatis 日志转换
- 剪贴板里已有内容时，首页会直接出现「使用剪贴板内容」的快捷入口
- 输入应用名（如「微信」）时会出现匹配到的本机应用，回车或点击即可启动

### 应用启动索引来源

启动时用后台线程异步扫描并缓存，不阻塞界面：

1. 开始菜单快捷方式（用户 + 全局，递归子文件夹）
2. 桌面快捷方式（用户桌面 + 公共桌面）
3. 注册表 `App Paths`（HKLM / HKCU，含 32 位视图）

名字里带 `uninstall` / `卸载` / `readme` / `帮助` 等的条目会被过滤掉；同名或同路径只保留一条。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| <kbd>Alt</kbd> + <kbd>Space</kbd> | 显示 / 隐藏窗口（全局） |
| <kbd>↑</kbd> <kbd>↓</kbd> | 选择功能 |
| <kbd>Enter</kbd> | 打开选中的功能 |
| <kbd>Esc</kbd> | 工具页返回首页；首页隐藏窗口 |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | curl 工具：解析并发送请求 |
| <kbd>Ctrl</kbd> + <kbd>C</kbd> | 复制选中内容 / 各工具内均有「复制结果」按钮 |

窗口失焦会自动隐藏，右下角托盘常驻，可右键「退出 DevKit」。

## 界面操作

- **移动窗口**：按住顶栏即可拖动。顶栏中除搜索框、返回按钮和滑块以外的区域（图标、标题、空白处）都是拖动区。
- **背景透明度**：顶栏右侧的 ◐ 滑块可在 20%–100% 之间调节面板透明度，设置会自动记住（localStorage），下次启动保持。
- 窗口不可最大化 / 最小化，避免误触把悬浮面板变成全屏窗口。

## 开发与运行

前置条件：

- Node.js ≥ 20
- Rust 稳定版 + **MSVC 工具链**（Windows 上 GNU/MinGW 工具链链接会失败，仓库已用 `src-tauri/rust-toolchain.toml` 固定为 `stable-x86_64-pc-windows-msvc`）
- Windows 需要 [WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 一般已自带）

```bash
# 安装前端依赖
npm install

# 桌面应用开发模式（热更新）
npm run app

# 只跑前端（浏览器里调 UI，Tauri 相关调用会自动降级为 Web API）
npm run dev

# 类型检查
npm run typecheck

# 打包安装程序（产物在 src-tauri/target/release/bundle/nsis）
npm run app:build
```

### 构建产物

| 产物 | 路径 |
| --- | --- |
| 免安装可执行文件（约 5 MB） | `src-tauri/target/release/devkit.exe` |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/DevKit_0.1.0_x64-setup.exe` |

桌面已创建 `DevKit.lnk` 快捷方式，直接指向 `devkit.exe`（图标取自 exe 内置图标）。
release 版启动后**不显示窗口**，只在托盘常驻，按 <kbd>Alt</kbd> + <kbd>Space</kbd> 唤起即可。

## 目录结构

```
src/
  main.ts              Spotlight 外壳：命令面板、键盘交互、智能识别
  bridge.ts            与 Rust 通信（浏览器下自动降级）
  dom.ts               极简 DOM 构造器
  styles.css           全部样式
  tools/
    index.ts           工具注册表
    types.ts           ToolModule 接口
    code-tool.ts       「左输入 / 右输出」通用外壳
    time.ts json.ts xml.ts yaml.ts curl.ts mybatis.ts
src-tauri/
  src/lib.rs           窗口切换、全局快捷键、托盘、剪贴板
  src/http.rs          HTTP 请求命令（reqwest，绕过 CORS）
  tauri.conf.json      窗口与打包配置
```

## 实现说明

- **全局快捷键与窗口切换在 Rust 侧完成**，只在按键按下时触发一次，避免抬起时重复切换。
- **HTTP 请求由 Rust 发出**（`reqwest` + rustls），不受浏览器 CORS 限制，可自定义超时、忽略自签证书、控制是否跟随重定向。
- **前端不引入 UI 框架**，所有界面由 `dom.ts` 构造，打包体积小、首屏快。
- 复制、剪贴板读取走 Tauri 官方插件，前端只调用自定义命令，无需额外权限声明。

## 已知限制

- 若 <kbd>Alt</kbd> + <kbd>Space</kbd> 已被其他程序占用，会在启动时打印注册失败日志，此时可从托盘菜单唤起。
- 开发模式（debug）下窗口不会失焦自动隐藏，方便调试；release 包才会启用该行为。
- MyBatis 日志里 `-F`/文件上传类 curl 参数无法完整还原，工具会在界面上给出提示。
- curl 的 `--form` 文件字段只保留字段名，不读取本地文件。
