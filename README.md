# auto-ugid

`auto-ugid` 是一个面向 UGLink 与 Emby 的中继域名监控器。它会定期查询绿联官方 API，在中继域名发生变化时执行严格校验、延时二次确认和 Emby Server ID 身份验证，确认新地址可信后再通过 Hermes Webhook 推送通知。

域名没有变化时保持静默，不会重复发送通知。

本仓库只包含监控程序、测试和部署示例，不会自动创建 Hermes 路由、修改 NAS 容器或写入生产凭据。

## 工作流程

```text
绿联官方 API
      ↓
获取 relayDomain
      ↓
严格白名单校验
      ↓
延时后再次查询确认
      ↓
Emby 公共信息与 Server ID 校验
      ↓
原子更新本地状态
      ↓
HMAC-SHA256 Webhook → Hermes deliver_only → 微信
```

候选域名只有通过以下全部门禁后才会被提交：

1. UGLink API 成功返回 `relayDomain`；
2. 域名严格匹配 `cn<数字>.ug.link` 或 `<alias>.cn<数字>.ug.link`；
3. 等待 `CONFIRMATION_DELAY` 后再次查询，结果与第一次完全一致；
4. `https://<域名>/emby/System/Info/Public` 返回有效 JSON，并包含 `Id`、`ServerName` 和 `Version`；
5. 返回的 Emby `Id` 与持久化的 Server ID 基线一致。

首次健康运行会建立域名和 Server ID 基线，默认不发送通知。旧版 `/app/last_domain.txt` 可以迁移，但程序必须先通过旧域名建立 Emby Server ID 基线，之后才会接受域名变化。

## 快速开始

### 使用 Docker Compose

1. 检查并按实际环境调整 [`docker-compose.yaml`](docker-compose.yaml)。
2. 通过受控方式提供 Hermes Webhook Secret，不要将真实 Secret 写入 Compose 文件：

```bash
export HERMES_WEBHOOK_SECRET='请替换为受控凭据'
docker compose config
docker compose up -d
```

3. 查看运行日志，并确认 `/data/state.json` 已建立正确的域名和 Emby Server ID 基线。

上述命令是部署示例。执行前应备份现有 Compose、状态文件和旧容器配置。

### 单次检查

在已经配置环境变量的情况下，可以执行一次检查后退出：

```bash
npm run start -- --once
```

查看无副作用的命令帮助：

```bash
npm run start -- --help
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---:|---:|---|
| `UG_ID` / `UGID` | 否 | `bmnd` | UGLink alias，以及可选域名前缀的白名单依据 |
| `HERMES_WEBHOOK_URL` | 是 | — | Hermes `/webhooks/<route>` 地址 |
| `HERMES_WEBHOOK_SECRET` | 是 | — | 路由独立使用的 HMAC Secret |
| `CHECK_INTERVAL` | 否 | `600` | 检查周期，单位为秒，最小值为 30 |
| `CONFIRMATION_DELAY` | 否 | `20` | 域名变化后二次确认的等待时间，单位为秒 |
| `REQUEST_TIMEOUT` | 否 | `10` | HTTP 请求超时，单位为秒 |
| `SOURCE_FAILURE_THRESHOLD` | 否 | `3` | 连续查询失败多少次后发送一次来源异常通知 |
| `NOTIFICATION_MAX_ATTEMPTS` | 否 | `5` | 单条 Hermes 通知的最大投递次数 |
| `NOTIFICATION_BACKOFF` | 否 | `30` | 通知首次重试退避时间，单位为秒 |
| `NOTIFY_ON_FIRST_RUN` | 否 | `false` | 为 `true` 时在首次建立基线后发送通知 |
| `STATE_DIR` | 否 | `/data` | 状态、事件与通知队列的持久化目录 |
| `LEGACY_DOMAIN_FILE` | 否 | `/app/last_domain.txt` | 旧版域名状态文件的迁移位置 |
| `UGLINK_API_URL` | 否 | 绿联生产 API | 仅供测试时覆盖 API 地址 |

`WEBHOOK_URL` 暂时作为 `HERMES_WEBHOOK_URL` 的弃用兼容别名。它会被当作 Hermes Webhook 地址处理，不再表示企业微信机器人地址。不要同时配置两个变量，也不要期待一次事件被双重投递。

所有 Secret 都应通过容器环境变量或其他受控凭据系统注入，不得提交到 Git、Compose、日志或文档中。

## Hermes Webhook 配置

程序采用 Hermes 通用 Webhook HMAC V2 格式：

- `X-Webhook-Timestamp`：Unix 秒级时间戳；
- `X-Webhook-Signature-V2`：对 `<timestamp>.<原始 JSON 请求体>` 计算 HMAC-SHA256 后得到的小写十六进制摘要；
- `X-Request-ID`：重试期间保持不变的稳定 `event_id`。

该格式与 Hermes 当前的 [`gateway/platforms/webhook.py`](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/webhook.py) 实现一致。Hermes 会检查时间戳的重放保护窗口，因此 NAS 与 Hermes 主机必须保持时钟同步。

以下是供人工审阅的 Hermes 路由示例。创建或修改该路由属于独立的生产操作，本仓库不会自动执行：

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      routes:
        uglink-status:
          secret: "<路由独立 Secret>"
          deliver: "weixin"
          deliver_only: true
          prompt: "{message}"
```

如果微信默认主通道不是目标接收方，应在 Hermes 侧配置相应的 `deliver_extra.chat_id`。

## 持久化文件

生产运行时必须持久化挂载 `/data`。程序会维护：

- `/data/state.json`：当前已提交域名、Emby Server ID、连续失败次数和告警状态；
- `/data/events.jsonl`：不包含凭据的必要事件审计摘要；
- `/data/pending-notifications.json`：带次数上限和退避策略的通知重试队列。

JSON 状态通过临时文件、`fsync` 和原子 `rename` 写入。损坏的状态文件或通知队列会先保留为 `.corrupt-<时间>` 文件，再使用安全的空结构继续处理。

## 本地开发与测试

容器和 CI 使用 Node.js 24 LTS。运行时没有第三方依赖。

```bash
npm test
npm run lint
npm run start -- --help
docker build -t auto-ugid:test .
```

自动测试使用 Mock，不会访问真实的 UGLink API、Emby 或 Hermes。

## 升级与状态迁移

1. 备份当前 Compose、镜像标签或摘要，以及旧容器中的 `/app/last_domain.txt`；
2. 准备一个持久化的宿主机目录并挂载到 `/data`；
3. 如需保留旧域名基线，将 `last_domain.txt` 复制到受保护的宿主机位置，并在首次启动时只读挂载到 `/app/last_domain.txt`；也可以不迁移，让当前健康的 Emby 实例重新建立基线；
4. 单独配置 Hermes 路由与 Secret，并在替换生产容器前发送受控测试事件；
5. 启动新容器，检查 `state.json` 中的域名和 Server ID 是否符合预期；当 `NOTIFY_ON_FIRST_RUN=false` 时，建立基线不会发送通知；
6. 验证无变化静默、来源异常只告警一次、恢复只通知一次，以及容器重启后不会虚假报变更；
7. 取得真实运行证据后，才能将本次变更记录为已部署。

不要把旧的企业微信机器人 URL 作为 Hermes Webhook 地址继续使用。

## 回滚

1. 停止新容器；
2. 恢复备份的 Compose 与上一版本镜像标签或摘要；
3. 如果旧镜像依赖 `last_domain.txt`，恢复对应状态文件；
4. 保留新版 `/data` 目录用于排查，旧版本无需直接使用该目录；
5. 启动旧容器，并重新验证其查询与通知行为。

代码回滚本身不能证明 UGLink、Emby、Hermes 或微信投递链路健康，仍需分别进行生产核验。

## 权限与生产边界

- 仓库代码和镜像发布不等于 NAS 已完成部署；
- 程序只负责监控与通知，不会自动修改播放器服务器地址；
- Hermes 只负责通知，不执行自动修复；
- NAS 容器替换、Hermes 路由和真实凭据变更必须单独审批与验证。
