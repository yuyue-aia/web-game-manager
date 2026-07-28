# Web 游戏时间管理器

独立的 Web 游戏时间管理服务 — 从原 Home Voice Assistant 项目中拆分出来，专用于游戏/电视时间限额管理。

## 功能

- **Web 管理界面**：浏览器访问，支持多用户登录（管理员 / 普通成员 / 测试账号）
- **游戏 / 电视时间管理**：按星期 + 每日配额限制，管理员可临时加时或设定总额
- **智能插板控制**：通过 Gosund 插板（cuco.plug.cp5d）控制游戏机（S3+S4）和电视（S3）通电/断电
- **电视安全关机**：Tuya 红外 → 确认海信 UPnP 待机 → 冷却 → 断电
- **凌晨自动充电**：固定时间窗口给游戏机通电，避免电池耗尽
- **iPad/设备禁网**：通过 Netgear 路由器定时控制设备联网权限
- **会话记录**：历史游戏/电视使用记录查询

## 架构

纯 Node.js HTTP 服务（零第三方框架），带 SPA 前端。不依赖 LLM、语音链路、腾讯云。

## 快速开始

```bash
cd apps/web-game-manager
npm install
cp .env.example .env
# 编辑 .env，至少填好 GOSUND_PLUG_TOKEN 和 GOSUND_PLUG_IP

# 前台启动
npm run web

# 后台启动
npm run web:daemon
npm run web:status
npm run web:logs
npm run web:stop
```

浏览器访问 http://localhost:8787，首次使用需要创建管理员账号。

### 开机自启（macOS / LaunchDaemon）

生产环境（例如家里的 Mac mini）推荐装成系统级 LaunchDaemon，开机自启、crash 自恢复：

```bash
sudo bash scripts/install-launchd.sh install     # 安装并启动
sudo bash scripts/install-launchd.sh status      # 查看状态
sudo bash scripts/install-launchd.sh uninstall   # 卸载（保留 .bak）
```

Daemon 以 `mac` 用户身份运行，工作目录固定为 `/Users/mac/code/web-game-manager`，日志继续写到 `.run/web.log`。安装前脚本会自动停掉 `npm run web:daemon` 起的 shell 进程避免抢端口。

## 目录结构

```
.
├── src/
│   ├── common/logger.ts             # 结构化日志
│   ├── config/env.ts                # 环境变量配置
│   ├── services/
│   │   ├── game-console-controller.ts  # 游戏机控制器（核心编排）
│   │   ├── game-quota.ts               # 配额管理
│   │   ├── game-session-timer.ts       # 会话定时器
│   │   ├── tv-safe-shutdown.ts         # 电视安全关机
│   │   ├── tuya-ir-client.ts           # Tuya 红外遥控
│   │   ├── auto-charge-scheduler.ts    # 凌晨自动充电
│   │   ├── ipad-access-scheduler.ts    # iPad 禁网调度
│   │   ├── netgear-device-registry.ts  # 路由器设备目录
│   │   ├── netgear-access-control-client.ts  # 路由器访问控制
│   │   └── plug/gosund-plug-client.ts  # Gosund 插板协议
│   └── web/
│       ├── start-web.ts       # 启动入口
│       ├── web-server.ts      # HTTP 服务 + 路由
│       ├── config-store.ts    # 游戏配置持久化
│       ├── users-store.ts     # 用户/会话管理
│       └── http-utils.ts      # HTTP 工具集
├── public/app/index.html      # SPA 前端
├── scripts/web-service.sh     # 启停脚本
└── .env.example               # 配置参考
```

## 与 Agent 版的关系

本项目是 **"Web 游戏时间管理"** 独立版，**不包含**语音助手、LLM Agent、ASR/TTS、唤醒词、音乐播放、提醒、Web Search、空调控制等功能。

如需语音交互版本，请查看同目录下的 `apps/agent-game-manager/`。