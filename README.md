# auto-ugid

**当前正式版本：`v1.2.1`**

`auto-ugid` 是一个通用的 UGLink 中继域名监控器。它定期查询绿联官方 API，严格校验并延时二次确认中继域名变化，然后通过可插拔通知驱动发送完整访问地址。

程序不再依赖 Emby 或其他具体业务服务。只要绿联 API 能返回有效中继域名，监控器就可以独立工作；域名没有变化时保持静默。

## 工作流程

```text
绿联官方 API
      ↓
获取 relayDomain（例如 cn59.ug.link）
      ↓
严格白名单校验
      ↓
规范化为完整主机名（your-id.cn59.ug.link）
      ↓
延时二次确认
      ↓
原子更新 /data/state.json
      ↓
通知驱动
  ├── Hermes：结构化 JSON + HMAC-SHA256 V2
  ├── 企业微信：群机器人 text Payload
  └── Generic：标准 JSON POST，可选 Bearer Token
```

API 返回的 `cn59.ug.link` 和 `your-id.cn59.ug.link` 会被视为同一个中继域名，状态和通知统一使用完整主机名 `your-id.cn59.ug.link`，对外地址统一为 `https://your-id.cn59.ug.link`。

## 快速开始

### Hermes 驱动

```bash
export AUTO_UGID_IMAGE_TAG='1.2.1'
export UG_ID='your-id'
export HERMES_WEBHOOK_SECRET='请替换为受控凭据'
docker compose config
docker compose pull
docker compose up -d
```

仓库中的 [`docker-compose.yaml`](docker-compose.yaml) 默认使用正式镜像 `1.2.1` 并演示 Hermes 驱动，可通过 `AUTO_UGID_IMAGE_TAG` 固定其他版本或完整 Commit SHA。执行前请检查 URL、alias、持久化目录和镜像版本。

### 单次检查

在已配置环境变量的情况下执行一次检查：

```bash
npm run start -- --once
```

查看无副作用帮助：

```bash
npm run start -- --help
```

查看当前代码版本：

```bash
npm run start -- --version
```

## 通知驱动

### 驱动选择规则

推荐显式设置 `NOTIFICATION_DRIVER`：

| 驱动 | `NOTIFICATION_DRIVER` | 必填配置 | 可选配置 |
|---|---|---|---|
| Hermes | `hermes` | `HERMES_WEBHOOK_URL`、`HERMES_WEBHOOK_SECRET` | — |
| 企业微信 | `wecom` | `WECOM_WEBHOOK_URL` | — |
| 通用 Webhook | `generic` | `GENERIC_WEBHOOK_URL` | `GENERIC_WEBHOOK_TOKEN` |

未显式设置时，程序按以下顺序自动识别：

1. 提供 `HERMES_WEBHOOK_SECRET` 或 `HERMES_WEBHOOK_URL` → `hermes`；
2. 提供 `WECOM_WEBHOOK_URL`，或 `WEBHOOK_URL` 的主机名为 `qyapi.weixin.qq.com` → `wecom`；
3. 提供 `GENERIC_WEBHOOK_URL` 或其他 `WEBHOOK_URL` → `generic`。

`WEBHOOK_URL` 仅作为兼容别名保留。新配置应优先使用各驱动的专用 URL 变量，避免自动识别产生歧义。

### Hermes

```yaml
environment:
  NOTIFICATION_DRIVER: hermes
  HERMES_WEBHOOK_URL: http://hermes-host:8644/webhooks/uglink-status
  HERMES_WEBHOOK_SECRET: ${HERMES_WEBHOOK_SECRET:?set HERMES_WEBHOOK_SECRET}
```

Hermes 驱动发送完整结构化事件，并使用：

- `X-Webhook-Timestamp`：Unix 秒级时间戳；
- `X-Webhook-Signature-V2`：对 `<timestamp>.<原始 JSON 请求体>` 计算的 HMAC-SHA256 十六进制摘要；
- `X-Request-ID`：重试期间稳定不变的 `event_id`。

Hermes 路由可以使用 `deliver_only: true` 和 `prompt: "{message}"` 直接投递消息，不启动模型。

### 企业微信

```yaml
environment:
  NOTIFICATION_DRIVER: wecom
  WECOM_WEBHOOK_URL: ${WECOM_WEBHOOK_URL:?set WECOM_WEBHOOK_URL}
```

Payload 为企业微信群机器人原生格式：

```json
{
  "msgtype": "text",
  "text": {
    "content": "UGLink 域名已更新……"
  }
}
```

除 HTTP 状态外，驱动还会检查响应中的非零 `errcode`。

### 通用 Webhook

```yaml
environment:
  NOTIFICATION_DRIVER: generic
  GENERIC_WEBHOOK_URL: https://hooks.example.com/uglink
  GENERIC_WEBHOOK_TOKEN: ${GENERIC_WEBHOOK_TOKEN:-}
```

如果提供 `GENERIC_WEBHOOK_TOKEN`，请求会携带 `Authorization: Bearer <token>`。Payload 格式为：

```json
{
  "event": "relay_changed",
  "message": "UGLink 域名已更新……",
  "data": {
    "event_id": "relay_changed-...",
    "old_domain": "your-id.cn58.ug.link",
    "new_domain": "your-id.cn59.ug.link",
    "old_url": "https://your-id.cn58.ug.link",
    "new_url": "https://your-id.cn59.ug.link"
  }
}
```

## 通用环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---:|---:|---|
| `UG_ID` / `UGID` | 是 | — | UGLink alias 与完整域名前缀 |
| `NOTIFICATION_DRIVER` | 否 | 自动识别 | `hermes`、`wecom` 或 `generic` |
| `CHECK_INTERVAL` | 否 | `600` | 检查周期秒数，最小值 30 |
| `CONFIRMATION_DELAY` | 否 | `20` | 二次确认等待秒数 |
| `REQUEST_TIMEOUT` | 否 | `10` | HTTP 请求超时秒数 |
| `SOURCE_FAILURE_THRESHOLD` | 否 | `3` | 连续查询失败多少次后告警一次 |
| `NOTIFICATION_MAX_ATTEMPTS` | 否 | `5` | 单条通知最大投递次数 |
| `NOTIFICATION_BACKOFF` | 否 | `30` | 首次重试退避秒数，后续指数增长 |
| `NOTIFY_ON_FIRST_RUN` | 否 | `false` | 首次建立基线后是否通知 |
| `STATE_DIR` | 否 | `/data` | 持久化目录 |
| `LEGACY_DOMAIN_FILE` | 否 | `/app/last_domain.txt` | 旧版文本状态迁移位置 |
| `UGLINK_API_URL` | 否 | 绿联生产 API | 仅供测试覆盖 API 地址 |

`UG_ID` 没有内置默认值；推荐使用 `UG_ID`，`UGID` 仅作为兼容变量保留。Compose 示例会在变量缺失时直接报错。

所有 Secret 和 Token 都必须通过容器环境变量或其他受控凭据系统注入，不得提交到 Git、Compose、日志或文档中。

仓库同时在 `.gitignore` 与 `.dockerignore` 中排除了 `.env`、本地 `data/` 和损坏状态备份，避免凭据或运行数据被误提交或发送到 Docker 构建上下文；如需提供模板，请使用不含真实值的 `.env.example`。

## 事件与通知内容

域名变化通知不包含具体业务应用名称：

```text
UGLink 域名已更新：
旧地址：https://your-id.cn58.ug.link
新地址：https://your-id.cn59.ug.link
时间：2026-08-23 16:50:00 +08:00
```

程序还会对绿联 API 连续异常和恢复发送去重通知。非法域名与二次确认不一致只写入本地事件审计，不覆盖当前状态，也不会重复向外推送候选告警。

## 状态与持久化

生产运行时必须持久化挂载 `/data`：

- `/data/state.json`：当前完整域名、来源失败次数和告警状态；
- `/data/events.jsonl`：不包含凭据的事件审计摘要；
- `/data/pending-notifications.json`：通知重试队列。

状态文件版本为 v2：

```json
{
  "version": 2,
  "currentDomain": "your-id.cn59.ug.link",
  "consecutiveSourceFailures": 0,
  "sourceAlertSent": false,
  "sourceAlertEventId": null,
  "lastSuccessfulCheckAt": "2026-08-23T08:50:00.000Z",
  "lastChangeAt": "2026-08-23T08:50:00.000Z"
}
```

程序启动时会自动把 v1 状态迁移为 v2：

- 删除旧 `serverId` 和候选告警字段；
- 将 `cn<N>.ug.link` 规范化为 `<alias>.cn<N>.ug.link`；
- 保留来源失败、告警和时间字段；
- 原子写回 `state.json`。

JSON 状态通过临时文件、`fsync` 和原子 `rename` 更新。损坏文件会先保留为 `.corrupt-<时间>` 文件。

## 版本与镜像发布

项目采用 Semantic Versioning，`package.json` 的 `version` 是代码版本权威来源。正式 Git 标签使用 `vX.Y.Z`，发布后不得移动或覆盖。

- 普通 `main` 合并只发布完整 Commit SHA 镜像；
- 正式标签 `v1.2.1` 发布 `v1.2.1`、`1.2.1`、`1.2`、`1`、`latest` 与 Commit SHA；
- `latest` 只代表最近一次正式稳定发布；
- Compose 与生产环境应固定 `X.Y.Z`、Commit SHA 或镜像摘要，不把 `latest` 作为唯一回滚依据；
- 历史 SHA 镜像继续保留，不追溯移动或伪造旧制品。

正式发布顺序为：发布 PR 通过门禁并合并 → 在 Merge Commit 创建 annotated Git 标签 → 标签 CI 发布多架构镜像 → 创建同名 GitHub Release → 核验标签与摘要。制品发布不等于生产部署。

## 本地开发与测试

容器与 CI 使用 Node.js 24 LTS，运行时没有第三方依赖。

```bash
npm test
npm run lint
npm run start -- --help
docker build -t auto-ugid:test .
```

自动测试使用 Mock，不访问真实 UGLink API、Hermes、企业微信或通用 Webhook。

## 升级步骤

1. 备份当前 Compose、镜像摘要和整个 `/data` 目录；
2. 显式配置 `UG_ID`；v1.2.1 起不再提供个人 alias 默认值；
3. 根据目标通道配置 `NOTIFICATION_DRIVER` 和对应 URL/凭据；
4. 如从现有 Hermes 版本升级，可以继续使用 `HERMES_WEBHOOK_URL` 与 `HERMES_WEBHOOK_SECRET`；
5. 如从旧企业微信版本升级，推荐把 `WEBHOOK_URL` 改名为 `WECOM_WEBHOOK_URL`；旧 URL 兼容自动识别仍然保留；
6. 启动新容器，确认日志中的驱动名称和 `state.json` v2 迁移结果；
7. 分别验证无变化静默、域名变化、来源异常/恢复和通知重试；
8. 取得真实运行证据后，才能记录为已部署。

## 回滚

1. 停止 v1.2.1 容器；
2. 恢复旧 Compose 和上一版本镜像摘要；
3. 恢复升级前备份的 `/data` 目录。旧版本无法读取 v2 状态，因此不能直接复用已迁移的 `state.json`；
4. 启动旧容器并重新验证查询与通知行为。

## 权限与生产边界

- 合并代码和发布镜像不等于 NAS 已部署；
- 程序不会修改播放器、DNS、Hermes 路由或企业微信配置；
- 生产容器替换、凭据调整和回滚必须单独审批并核验。
