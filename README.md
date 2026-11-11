<!-- 
  Designed & Built with ❤️ by MeiSiristhebest (https://github.com/MeiSiristhebest)
  If this repository helps your learning or engineering, please consider dropping a ⭐ Star!
-->
<h1 align="center">📦 Win-Box</h1>

<p align="center">
  <b>简体中文 | <a href="./README.en.md">English</a></b>
</p>

> [!TIP]
> 💡 **如果本项目的架构设计、工程实现或桌面播放体验对你的开发或学习有所启发，欢迎点亮右上角的 ⭐ Star 支持！**
> 📚 **技术蓝图与架构设计文档：[ARCHITECTURE.md](./ARCHITECTURE_BACKLOG.md)**
> ⚖️ **使用前请务必仔细阅读本项目的 [⚠️ 免责声明](#️-免责声明请务必阅读)。本项目为个人研究性质的开源播放器外壳工具，不存储、不提供、不推送任何影视内容与资源。**

<p align="center">
  <b>Windows 桌面端高可用媒体源管理与聚合播放工作站</b>
</p>

<p align="center">
  <a href="https://github.com/MeiSiristhebest/Win-box/releases/latest"><img src="https://img.shields.io/github/v/release/MeiSiristhebest/Win-box?style=flat&color=3b82f6" alt="Latest Release" /></a>
  <a href="https://github.com/MeiSiristhebest/Win-box/actions"><img src="https://img.shields.io/badge/tests-4452%20passed-brightgreen?style=flat" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-blue?style=flat" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=flat&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<p align="center">
  <em>基于 Electron + React 19 + TypeScript + Vite 打造的模块化、工业级 Windows 桌面端媒体工作站与聚合播放器。提供解耦的多仓订阅隔离、双字符组（Dice）模糊聚合检索、源站点阶梯熔断保护、HTML5 与 MPV GPU 超分辨率双内核解码、本地 HTTP Range 虚拟分片代理及局域网 DLNA 投屏。</em>
</p>

---

## 📑 目录

- [💡 概述](#-概述)
  - [Win-Box 是什么？](#win-box-是什么)
  - [Win-Box 不是什么？](#win-box-不是什么)
  - [架构分层与进程拓扑](#架构分层与进程拓扑)
- [✨ 核心工程特性](#-核心工程特性)
  - [1. 多仓源管理与跨源生命周期隔离](#1-多仓源管理与跨源生命周期隔离)
  - [2. 动态榜单元数据与流媒体播出索引](#2-动态榜单元数据与流媒体播出索引)
  - [3. Sørensen–Dice 字符模糊匹配与集数归一化](#3-sørensendice-字符模糊匹配与集数归一化)
  - [4. 站点健康度自愈与阶梯熔断保护](#4-站点健康度自愈与阶梯熔断保护)
  - [5. 双播放内核协商与 MPV GPU 实时超分辨率](#5-双播放内核协商与-mpv-gpu-实时超分辨率)
  - [6. 本地虚拟 Range 分片代理与断流自愈网关](#6-本地虚拟-range-分片代理与断流自愈网关)
  - [7. 局域网 DLNA 投屏接收与控制器 (DMR / DMC)](#7-局域网-dlna-投屏接收与控制器-dmr--dmc)
  - [8. Windows DPAPI 凭据本地硬件级加密存储](#8-windows-dpapi-凭据本地硬件级加密存储)
- [⚙️ 环境依赖与前置要求](#️-环境依赖与前置要求)
- [📦 安装与运行](#-安装与运行)
- [🛠️ 源码开发与常用命令](#️-源码开发与常用命令)
- [🛡️ 5 大核心工程不变量](#️-5-大核心工程不变量)
- [📂 项目目录结构](#-项目目录结构)
- [⚠️ 免责声明（请务必阅读）](#️-免责声明请务必阅读)
- [🤝 参与贡献](#-参与贡献)
- [📜 开源协议与版权](#-开源协议与版权)
- [⭐ 支持与 Star History](#-支持与-star-history)

---

## 💡 概述

### Win-Box 是什么？

**Win-Box** 是一款运行在 Windows 平台上的**模块化、高可用媒体源管理与聚合播放桌面应用**。它将 TVBox / CatVod 开放规范完整移植到 Windows 桌面环境，提供多仓订阅导入、全源并发聚合检索、多语言权威元数据索引、HTML5 / MPV 双解码内核无缝切换与局域网投屏互动，帮助开发者和个人用户在电脑端管理与播放自备媒体资源。

### Win-Box 不是什么？

- **不是视频内容分发平台**：项目本身不内置、不提供、不运营任何影视资源索引或服务器，所有播放数据均由用户自行配置与导入。
- **不是不可控的脚本宿主**：第三方蜘蛛解析扩展严格运行于独立的 JVM 子进程、嵌入式 CPython 环境或隔离的 Node VM 沙箱中，具备确定的资源配额与故障隔离屏障。
- **不是遥测或隐私收集器**：项目不含任何遥测探针、数据打点或远程行为监控，所有订阅、历史记录、网盘凭据与缓存均保存在用户本机。

### 架构分层与进程拓扑

```text
    ┌──────────────────────────────────────────────────────────────────┐
    │                    Renderer Layer (React 19 SPA)                 │
    │        Discover · Detail · Search · Player · History · Config    │
    │                                                                  │
    │  usePlayerPageSession · TitleBarView · ShellChrome · VirtualGrid │
    └───────────────────────────┬──────────────────────────────────────┘
                                │ Typed ContextBridge (window.api)
                                ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │                   Electron Main Process Core                     │
    │                                                                  │
    │  UserConfigService · MetadataService · DownloadManager · DMR     │
    └───────────────────────────┬──────────────────────────────────────┘
                                │ IPC / Worker Threads / Native Stubs
                                ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │                 Spider & Stream Execution Engine                 │
    │                                                                  │
    │  AggregateSearchCoordinator · SourceCircuitBreaker · JarLoader  │
    │  JsSandbox (VM) · PythonRunner (CPython) · LocalProxyServer      │
    └──────────────┬───────────────────────────────┬───────────────────┘
                   │                               │
                   ▼ Native Storage Port           ▼ Media Playback Port
    ┌──────────────────────────────┐ ┌─────────────────────────────────┐
    │      Storage & Database      │ │      Dual Playback Kernels      │
    │                              │ │                                 │
    │  • SQLite (better-sqlite3)   │ │  • HTML5 Video + HLS.js         │
    │  • Windows DPAPI Vault       │ │  • Embedded MPV + GLSL Shaders  │
    │  • Local Imports Store       │ │  • DLNA DMR / Playback Relay    │
    └──────────────────────────────┘ └─────────────────────────────────┘
```

---

## ✨ 核心工程特性

### 1. 多仓源管理与跨源生命周期隔离

支持同时导入多套独立的站源配置（自建仓、在线多仓、本地包源），维护清晰的订阅树状态机：
- **原子切换调度**：通过 `UserConfigApplicationService` 维护订阅状态机，单次切换仅更新激活索引并原子通知视图刷新，无须冷启动重载。
- **网络代理智能容灾**：拉取 GitHub 订阅源时若遇加速代理 404 或超时，自动无缝回退至原生 Raw 节点。
- **故障隔离保护**：单个订阅仓拉取失败不影响已持久化的历史节点，保障基础浏览与播放连续性。

**📂 核心源码**：
- [UserConfigApplicationService.ts (用户配置应用服务)](src/main/store/UserConfigApplicationService.ts)
- [SubscriptionConfigFetcher.ts (订阅拉取与代理回退)](src/main/subscriptions/SubscriptionConfigFetcher.ts)

---

### 2. 动态榜单元数据与流媒体播出索引

通过标准化接口集成第三方权威影视元数据，上映年份根据自然时间自动滚动：
- **去中心化权威聚合**：接入豆瓣实时热门榜、IMDb Top 250、Bangumi 每日放送日历与 TMDB 多语言元数据。
- **流媒体平台播出徽标**：解析 TMDB `watch/providers` 数据，在详情页标记 Netflix、Disney+、Apple TV+、Prime Video、腾讯视频、爱奇艺等官方上线平台。
- **时间窗口滚动计算**：上映年代采用动态窗口算法（基于当前年份向前计算），避免配置中出现写死年份。

**📂 核心源码**：
- [domesticDiscover.ts (豆瓣 / Bangumi / IMDb 实时接口解析)](src/main/meta/domesticDiscover.ts)
- [tmdbProvider.ts (TMDB 元数据与流媒体播出平台解析)](src/main/meta/tmdbProvider.ts)
- [discoverBoards.ts (榜单注册表与动态自然年份计算)](src/shared/discoverBoards.ts)

---

### 3. Sørensen–Dice 字符模糊匹配与集数归一化

聚合搜索时各源返回标题格式多样，通过字符相似度与季数隔离算法保证多源结果的精准对齐：
- **Sørensen–Dice 系数**：将标题切分为 2-gram 字符子串集合并计算集合相似比率，在保持低计算开销的同时适应中英混合标题。
- **续作与季度隔离门禁**：对提取出的季度标识（`S01`、`第1季`）及续集数字进行严格校验；发生季数冲突时相似度强制置为 0，防止跨季串源。
- **集数清洗提取器**：通过 `episodeNormalizer` 正则处理管道剔除压制组、分辨率、HDR 等噪点标签，精确提取剧集编号。

**📂 核心源码**：
- [searchTitleMatching.ts (Sørensen–Dice 模糊匹配与续作隔离)](src/shared/searchTitleMatching.ts)
- [episodeNormalizer.ts (集数清洗与杂音过滤管线)](src/shared/episodeNormalizer.ts)

---

### 4. 站点健康度自愈与阶梯熔断保护

聚合搜索会向数十个配置源发起并发拉取，针对网络抖动、失效源与死循环接口引入轻量熔断器（Circuit Breaker）：
- **阶梯冷却隔离**：连续失败 1 次记录状态不阻断，连续失败 2 次冷却 15 分钟，3 次冷却 2 小时，4 次及以上进入 24 小时长期隔离，避免无效连接拖垮搜索并发。
- **自动探活自愈**：冷却期结束后自动放行探测请求；单次请求成功即重置错误计数并恢复正常服务。
- **用户操作豁免**：用户主动点击“强制刷新”或手动重试时绕过冷却限制，直接发起即时校验。

**📂 核心源码**：
- [sourceCircuitBreaker.ts (源站点熔断状态机)](src/engine/vod/sourceCircuitBreaker.ts)
- [AggregateSearchCoordinator.ts (聚合搜索并发调度与熔断挂载)](src/main/spider/AggregateSearchCoordinator.ts)

---

### 5. 双播放内核协商与 MPV GPU 实时超分辨率

内置 HTML5 与独立 MPV 双渲染解码内核，平衡资源开销与解码兼容性：
- **内核自动降级**：默认优先使用低开销的 HTML5 原生播放；检测到封装或编码不受支持时，平滑回退至内置 MPV 播放内核。
- **Anime4K 着色器管线**：MPV 内核支持加载 Anime4K 等 GLSL GPU 实时超分辨率着色器，提供画质倍线与降噪重建。

**📂 核心源码**：
- [PlayerSuperResolutionControl.tsx (超分辨率着色器挂载控件)](src/renderer/features/playback/PlayerSuperResolutionControl.tsx)
- [playerPageSessionWorkflow.ts (播放会话状态机与内核降级)](src/renderer/features/playback/application/playerPageSessionWorkflow.ts)

---

### 6. 本地虚拟 Range 分片代理与断流自愈网关

解决部分源站不支持 HTTP Range 分段或偶发网络断流导致的播放器 Seeking 卡死问题：
- **虚拟 206 流式切片**：本地代理网关（`127.0.0.1` Relay）拦截播放请求，向下游播放内核统一提供标准 HTTP 206 Partial Content 响应头。
- **断点自愈续传**：远程源连接中断时，网关依据当前 byte 偏移量发起断点重连，播放器无需重置即可连续接收流数据。

**📂 核心源码**：
- [PlaybackRelayService.ts (流式重传与中继服务)](src/main/server/PlaybackRelayService.ts)
- [LocalProxyServer.ts (本地代理中继网关)](src/main/server/LocalProxyServer.ts)

---

### 7. 局域网 DLNA 投屏接收与控制器 (DMR / DMC)

内置完整的局域网多媒体投屏协议栈：
- **DMR 投屏接收端**：Win-Box 可作为局域网数字媒体渲染器，接收手机端爱优腾、B站等客户端推送的音视频流。
- **DMC 投屏控制端**：支持将正在播放的媒体内容投送至局域网电视、小米盒子等大屏设备。

**📂 核心源码**：
- [DlnaDmrService.ts (DLNA DMR 接收端服务)](src/main/dlna/dmr/DlnaDmrService.ts)
- [DlnaService.ts (DLNA 发现与控制服务)](src/main/dlna/DlnaService.ts)

---

### 8. Windows DPAPI 凭据本地硬件级加密存储

网盘（阿里云盘、夸克、UC、115 等）OAuth Token 与密码信息采用系统级硬件安全机制保护：
- **DPAPI 本地保护**：调用 Windows 数据保护 API 对存储的 Access Token 与 Refresh Token 进行对称加密。
- **跨仓凭据共用**：不同订阅仓导入相同网盘站点时，自动关联复用已绑定的加密凭据，无需重复授权。

**📂 核心源码**：
- [WinDpapiService.ts (Windows DPAPI 原生安全绑定)](src/main/crypto/WinDpapiService.ts)
- [DriveCredentialService.ts (网盘凭据生命周期管理)](src/main/drive/DriveCredentialService.ts)

---

## ⚙️ 环境依赖与前置要求

| 运行/编译环境 | 版本要求 | 用途说明 |
| :--- | :--- | :--- |
| **Windows 操作系统** | Windows 10 及以上（x64） | 客户端原生运行平台 |
| **Node.js** | $\ge 22.12.0$（推荐 Node 24+ LTS） | 构建、测试与运行时环境 |
| **pnpm** | $\ge 9.0.0$（项目锁定 `12.14.0`） | 依赖解析与包管理 |
| **JDK / JRE** | 17 及以上 | JVM 蜘蛛运行时与转换桥 |

---

## 📦 安装与运行

### 方式一：下载 Windows 安装包（直接使用）

访问 [Releases 页面](https://github.com/MeiSiristhebest/Win-box/releases/latest) 下载最新版本的 `Win-Box.Setup.X.Y.Z.exe` 安装包，双击运行即可完成安装。

### 方式二：从源码编译打包

```bash
# 1. 克隆代码仓库
git clone https://github.com/MeiSiristhebest/Win-box.git
cd Win-box

# 2. 安装依赖
pnpm install

# 3. 编译主进程与渲染层
pnpm run build

# 4. 构建 Windows NSIS 安装包
pnpm run dist
```

打包产物生成于 `release<版本号>/Win-Box.Setup.<版本号>.exe`。

---

## 🛠️ 源码开发与常用命令

| 命令 | 行为说明 | 典型场景 |
| :--- | :--- | :--- |
| `pnpm run dev` | 启动 Vite + 主进程监听并唤起 Electron | 日常功能迭代开发 |
| `pnpm test` | 执行全套 Vitest 单元与集成测试 | 提交前逻辑回归校验 |
| `pnpm run typecheck` | 执行主进程、渲染层与测试目录双重类型检查 | 编译前 TypeScript 静态检查 |
| `pnpm run lint` | 执行 Oxlint 与架构依赖合规检查 | 代码规范性与边界门禁 |
| `pnpm run build` | 编译打包主进程、预加载脚本与前端 SPA | 生成可执行前置产物 |
| `pnpm run dist` | 执行完整资源校验并打包 Windows 安装器 | 发布新版本 |
| `pnpm run test:installer` | 运行 NSIS 安装、覆盖与卸载实机断言 | 验证安装器数据持久化安全性 |

---

## 🛡️ 5 大核心工程不变量

1. **零内置依赖与外壳解耦 (Decoupled Player Shell)**：
   应用核心仓库不捆绑任何外部影视源与非法视频直链；所有内容解析均严格依托用户自配的第三方端点。
2. **本地优先与零遥测隐私保障 (Local-First & Zero Telemetry)**：
   用户的所有配置、观看历史、收藏记录与网盘授权 Token 均经 Windows DPAPI 本地落盘加密，绝不向任何中心服务回传数据。
3. **全量自动化测试验收门禁 (100% Quality Gate)**：
   所有版本发布必须通过全部 545 个测试文件（4,452+ 用例）、12 项 NSIS 真实安装周期测试与严格类型检查。
4. **多引擎沙箱运行时隔离 (Isolated Multi-Engine Sandbox)**：
   各类蜘蛛模块分别运行于受保护的独立 JVM、嵌入式 Python 及 Node VM 环境中，具备完善的超时限制与崩溃容灾保护。
5. **流式分片容灾与断点自愈 (Deterministic Stream Recovery)**：
   通过本地虚拟 Range 206 代理与自动重连算法，确保视频流在网络抖动或源站限制下依旧平滑缓冲。

---

## 📂 项目目录结构

```text
win-box/
├── build/                            # 打包资源、安装器脚本与多分辨率图标
│   ├── icon.ico                      # Windows 多层级 ICO 图标文件
│   └── icon.png                      # 1024x1024 品牌母版图标
├── resources/                        # 随安装包分发的本地静态运行时资源
│   ├── aria2/                        # 磁力下载守护进程
│   ├── js-lib/                       # JS 蜘蛛依赖的核心库脚本
│   ├── jvm/                          # JRE 运行时、dex2jar 与 stubs 桥接库
│   └── ui/                           # 应用内原生标题栏与品牌图标
├── scripts/                          # 工程构建、测试合规与发布辅助工具链
├── src/
│   ├── engine/                       # 纯 TS 领域业务与源解析规则引擎
│   │   ├── config/                   # 配置文件解析与本地包加载
│   │   ├── live/                     # 直播频道、EPG 与 M3U/TXT 订阅解析
│   │   ├── spider/                   # 蜘蛛接口抽象与适配定义
│   │   └── vod/                      # 点播数据流转与熔断器机制
│   ├── main/                         # Electron 主进程核心层
│   │   ├── crypto/                   # 本地凭据加密与密钥管理
│   │   ├── dlna/                     # 局域网投屏控制 (DMC) 与渲染 (DMR)
│   │   ├── download/                 # 统一下载管理与分片落盘
│   │   ├── ipc/                      # 跨进程强类型 IPC 消息通道分发
│   │   ├── meta/                     # 豆瓣、TMDB 等元数据聚合服务
│   │   ├── server/                   # 本地 HTTP 代理网关与 Range 中继
│   │   └── spider/                   # JVM / Python / Node 蜘蛛调度器
│   ├── renderer/                     # 渲染层前端界面 (React 19 + Fluent UI)
│   │   ├── api/                      # 渲染层 IPC 包装客户端
│   │   ├── components/               # 通用基础视图与无障碍控件
│   │   ├── features/                 # 业务功能域组件 (播放、详情、发现、配置)
│   │   ├── layouts/                  # 顶栏、侧边栏与整体视窗布局
│   │   └── pages/                    # 路由视图主页面
│   └── shared/                       # 跨进程共享模型与 DTO 契约类型
├── tests/                            # Vitest 单元与集成自动化测试用例套件
├── package.json
└── README.md
```

---

## ⚠️ 免责声明（请务必阅读）

1. **软件性质**：Win-Box 是开源学习与技术研究项目，本质上只是一个**通用影片播放工具**（播放器外壳）；不含任何商业盈利行为，不提供在线服务、**不存储、不分发、不推送任何影视资源与内容**。
2. **不提供内容**：本项目**不内置任何资源索引、不运营任何内容服务器**。你自行配置与导入的播放源、直播源、弹幕与字幕接口、网盘凭据与音视频内容，全部来自**第三方**，与本软件及作者无关；软件内的本地中继代理（`127.0.0.1`）仅用于本机音视频播放的转发与断点恢复。
3. **无隶属关系**：本项目与任何影视平台、内容站点、网盘服务商、TVBox / CatVod 及其发行方**均无任何隶属、合作、代理或授权关系**；相关名称与商标归各自权利人所有。
4. **使用者责任**：请确保你导入的第三方源与播放使用行为**严格符合你所在地适用的法律法规**，严禁用于传播、观看任何侵犯知识产权或违法的音视频内容；因使用第三方来源引发的一切后果由用户与第三方自行承担，作者免责。
5. **权利通知**：本软件不对任何第三方内容主张版权，也未从第三方内容中获取任何利益。若版权权利人认为本项目某些代码行为涉及侵权风险，请通过 Issues 联系，作者将及时核实并配合妥善处理。
6. **免责条款**：软件按**「现状」**（AS-IS）提供，不附带任何明示或默示的担保责任；作者不对因使用或无法使用本软件所造成的任何直接或间接损失承担责任。若不接受上述条款，请立即停止使用并删除本软件。

---

## 🤝 参与贡献

欢迎对 Win-Box 提出改进建议或提交代码！在发起 Pull Request 之前，请遵循以下工程准则：
- 确保代码变更严格符合主进程、渲染层与引擎层的分层依赖约束。
- 提交前本地运行 `pnpm test` 并确认全部用例通过。
- 运行 `pnpm run typecheck` 与 `pnpm run lint` 确保 0 警告、0 错误。

---

## 📜 开源协议与版权

本项目核心代码采用 [MIT License](LICENSE) 许可分发。  
Copyright (c) 2026 MeiSiristhebest.

第三方依赖库与运行时（如 JRE、aria2c、dex2jar、hls.js 等）遵守各自原作者的开源许可证协议。

---

## ⭐ 支持与 Star History

如果 Win-Box 为你的媒体管理或开发学习带来了帮助，欢迎为本项目点亮一颗 ⭐ Star！

<a href="https://www.star-history.com/?repos=MeiSiristhebest%2FWin-box&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=MeiSiristhebest/Win-box&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=MeiSiristhebest/Win-box&type=date&theme=dark&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=MeiSiristhebest/Win-box&type=date&legend=bottom-right" />
 </picture>
</a>

### 🤝 贡献者

<a href="https://github.com/MeiSiristhebest/Win-box/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=MeiSiristhebest/Win-box" alt="Contributors" />
</a>
