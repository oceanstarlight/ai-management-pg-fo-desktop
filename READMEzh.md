<div align="center">

# Encela

**Claude Code 的桌面助手：在项目地图上实时看到它正在做什么，并把合适的 skill、服务器和决定放进你的提示词——就在你的终端旁边。**

[English](README.md) · [한국어](READMEkr.md) · **中文**

[![最新版本](https://img.shields.io/github/v/release/oceanstarlight/ai-management-pg-fo-desktop?label=download)](https://github.com/oceanstarlight/ai-management-pg-fo-desktop/releases/latest)
![平台](https://img.shields.io/badge/platform-Windows-0078d4)
[![许可证](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

</div>

> [!NOTE]
> 项目处于早期开发阶段。目前优先支持 Windows，Linux 和 macOS 计划在之后支持。
>
> 应用界面目前提供英文和韩文。

## 为什么做这个

Claude Code 工作时会读文件、改文件、运行命令、启动子代理，而这些在终端里一闪而过。它的配置（`CLAUDE.md`、规则、skill、subagent、MCP 服务器）也分散在很多文件里。

Encela 把这两者放进一个窗口：

- **观看**：Claude 此刻在读或改哪个文件、在运行什么、这一轮进行到哪里，实时显示在项目地图上。
- **推荐**：写提示词时找到合适的 skill、subagent、MCP 服务器和自动化；新项目还有起步表单。
- **记录决定**：保存你和 Claude 定下的东西（平台、语言、框架……），并放回每个提示词。
- **侧边栏**：贴在终端或编辑器旁边，随时一眼可见。

## 功能一览

| 页面 | 可以做什么 |
|---|---|
| 📡 **实时**（首页） | Claude Code 正在做的事：状态标记和本轮数字（工具、读取、修改、行数、命令、上下文、费用），读取和修改时会亮起的项目文件地图，以及每一步的时间线。旁边是提示词输入框和推荐、新项目起步表单、项目决定和分支笔记 |
| 📁 **项目** | 编辑 `CLAUDE.md`、规则、skill、agent 和设置文件；查看项目生效的内容及来源；决定；起步表单 |
| 🧰 **工具箱** | 你的 skill 与 subagent 库、MCP 服务器、开源扩展，以及约 100 个可复制的现成积木块 |
| ⏰ **自动化** | 按计划运行你的 `claude`（例如每天早上用 Haiku 子代理收集新闻并发邮件给你） |
| 📝 **笔记** | 每个仓库和分支的笔记与待办，可在多台设备间同步 |
| 📌 **侧边栏** | 把实时、推荐和笔记放进窄面板，贴在你正在使用的窗口旁 |

## 支持的工具

实时、推荐和决定适用于 **Claude Code**（终端、cmd、Claude 桌面应用的 Code 标签页，以及云端 claude.ai/code）。项目文档、库和 MCP 服务器也支持 **Codex** 项目。

## 安装

1. 从 **[Releases](https://github.com/oceanstarlight/ai-management-pg-fo-desktop/releases/latest)** 下载最新的 `*-setup.exe`。
2. 运行它。安装程序还没有代码签名，Windows SmartScreen 可能会警告：选择 **更多信息 → 仍要运行**。
3. 应用在启动时和每 6 小时检查更新，并提供 **更新并重启**。

**还需要** [Claude Code](https://docs.claude.com/en/docs/claude-code) 2.1.287 或更高版本。应用运行你已安装的 `claude` 命令，从不询问你的登录信息。

## 快速开始

1. **连接 Claude**（首次运行时设置页会打开到这里）：一键安装 Encela 连接 mod。claude.ai/code 请按云端清单操作。
2. 在菜单顶部 **选择项目**。
3. 在该文件夹中 **启动 Claude Code**。应用会作为侧边栏贴在旁边并开始绘制它的动作。<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> 显示或隐藏，托盘图标可重新打开主窗口。

## 详细介绍

### 📡 实时

- **状态**：空闲、思考中、读取中、搜索中、修改中、运行中、子代理工作中……以及它正在处理的文件或命令、本轮已用时间。
- **本轮数字**：工具调用、读取、修改、增删行数、命令、失败次数、上下文占用、会话费用。
- **文件地图**：项目里每个文件都是一块瓷砖，按顶层文件夹分组。读过的文件呈冷色，改过的文件呈暖色（改得越多越亮），正在处理的文件上有标记。
- **时间线**：每个提示词以及其下的所有工具调用：文件或命令、改动行数、成功或失败。
- 多个会话（终端与云端）可在顶部切换。这些内容不保存也不同步，只在应用运行期间存在。

### ✨ 推荐与决定

在应用里或 Claude Code 输入框上方写提示词时，Encela 会找出合适的内容：Claude Code 已有的 skill、subagent 和命令，库中的条目，MCP 服务器，扩展，以及你的自动化。关键词匹配立即显示，停顿后由你自己的 `claude` 让 Haiku 挑选。**润色** 把提示词改写得更清晰，**原文** 可以恢复。Claude 在回答中定下的东西会保存在 **决定** 里并进入每个提示词，确认后写入 `CLAUDE.md`。全新项目（没有 `CLAUDE.md` 也没有决定）会显示 **起步表单**（通用、网站与应用、自动化与 CLI、数据与 AI），填写的字段会生成第一个提示词；表单可以编辑。

### ☁️ 云端 Claude Code

登录应用账号，打开云端连接，把设置脚本粘贴到云端环境的 Setup script。提示词、回答和工具调用（工具、文件路径、命令前 300 个字符、改动行数；从不发送文件内容）通过 Firebase Realtime Database 的一条流式连接到达应用，收到后立即删除。

### 📁 项目 · 🧰 工具箱

- **文档** 找出 `CLAUDE.md`（含子文件夹）、规则、skill、agent、命令和设置文件，可在应用内编辑。**生效内容** 按作用域和状态显示工具读取的一切，并可为每个项目开关库中的条目。
- **库** 保存你常用的 skill 和 subagent。**MCP 服务器**：列出、添加、编辑、删除并检查连接。**扩展**：用你自己的 `claude` 安装经过许可证检查的开源 Claude Code 扩展。**目录**：约 100 个现成积木块（应用自带加上经过许可证检查的开源合集，见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)），可阅读和复制。
- 分支、本地改动、PR 和 CI 显示在实时页面（PR 与 CI 需登录 GitHub）；git 操作交给终端和 Claude Code。

### ⏰ 自动化

选择时间或间隔、模型、可用工具，以及接收结果的邮箱。应用或托盘图标运行期间使用你自己的 `claude -p` 执行。Claude Code 也可以通过应用的 MCP 服务器列出、创建和运行自动化。

### 📝 笔记与同步

每个仓库和分支的笔记与待办，切换分支时会跟随。在 Claude Code 里，连接 mod 会在输入框上方显示它们，并添加 `/todo`、`/memo` 和 `/notes`。可用应用账号（邮箱、Google 或 GitHub）在多台设备间同步。

## 隐私与安全

- 应用 **绝不读取、复制或保存你的 Claude 登录信息**（`~/.claude/.credentials.json` 或令牌）。AI 功能只是原样运行你安装的 `claude` / `codex` 命令。
- GitHub 和账号令牌保存在系统凭据存储（Windows 凭据管理器）中。GitHub 令牌只会以环境变量形式传给单条 git 命令。
- 设置文件按"读取 → 合并 → 写入"的方式修改，应用不认识的键会原样保留。
- 在你登录并开启同步之前，不会向服务器发送任何内容。

## 开发者

<details>
<summary><b>从源码构建</b></summary>

**环境要求**

- Node.js 22+ 和 pnpm 10（`corepack enable`）
- Rust 1.90+（`rustup`）
- Windows：[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（"使用 C++ 的桌面开发"）和 WebView2（Windows 11 已内置）
- Linux：`libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev`

另见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

```bash
pnpm install
pnpm tauri dev      # 以开发模式运行应用
pnpm lint           # Biome 代码检查 + 格式检查
pnpm build          # 类型检查 + 前端构建
pnpm tauri build    # 构建安装包
```

Rust 检查（在 `src-tauri/` 中）：

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Claude Code mod 检查（在 `claude-mod/branch-notes/` 中）：

```bash
claude plugin validate .
claude plugin test .
```

</details>

<details>
<summary><b>目录结构</b></summary>

| 路径 | 内容 |
|---|---|
| `src/` | React 19 + TypeScript 前端（`workspace/` 主窗口、`sidebar/` 边栏、`features/` 共用面板） |
| `src-tauri/` | Rust 后端（Tauri 2）。`tools/` 为每个 AI 工具提供适配器，`catalog/` 存放积木块目录，`activity.rs` 负责实时会话视图 |
| `claude-mod/` | Claude Code mod（通过 `<应用数据>/bridge` 中的文件与应用通信） |
| `firebase/` | 同步的安全规则 |
| `docs/` | 计划、调研资料、配置指南、测试清单（韩文） |

</details>

<details>
<summary><b>文档</b></summary>

- [`docs/PLAN.md`](docs/PLAN.md)：决策与路线图
- [`docs/research.md`](docs/research.md)：附来源的调研资料
- [`docs/sync-setup.md`](docs/sync-setup.md)：同步（Firebase）配置
- [`docs/release-setup.md`](docs/release-setup.md)：发布与应用更新
- [`docs/testing/`](docs/testing/)：手动测试清单

</details>

CI（`.github/workflows/ci.yml`）在 Linux 上进行代码检查和构建，并构建 Windows 安装包。合并到 `main` 的每个新版本都会发布为 GitHub Release。

## 许可证

[Apache-2.0](LICENSE)。打包的第三方积木块的许可证列在 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 中。

本项目与 Anthropic 或 OpenAI 无关，未获得其赞助或认可。Claude 是 Anthropic, PBC 的商标；Codex 和 ChatGPT 是 OpenAI 的商标。
