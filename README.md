# Activation SMS Platform

基于 Next.js 14 + TypeScript + Tailwind + shadcn/ui + Prisma + PostgreSQL 的激活码sms系统。

## 功能概览

- 用户输入激活码，服务端校验并防并发重复核销
- 服务端向短信供应商申请号码
- 前端展示手机号并每 5 秒轮询会话状态
- 收到短信后自动提取 4-8 位验证码并展示
- 激活码一次性使用
- 管理员后台（登录、激活码管理、会话管理）
- 管理员可单码检查、失效、恢复可用状态
- 管理员可一键查询短信平台余额，低余额可邮件告警
- 每日自动巡检：unused 低于阈值自动补码并邮件发送 txt
- 支持 webhook 扩展接收短信
- 统一 JSON 响应、日志、限流、超时处理、审计日志

## 技术栈

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui 风格组件
- PostgreSQL + Prisma ORM
- Node.js 服务端逻辑

## 快速启动

1. 复制环境变量：

```bash
cp .env.example .env
```

2. 启动 PostgreSQL（Docker）：

```bash
npm run db:up
```

3. 初始化：

```bash
npm run init
```

仅第一次启动或 Prisma schema 发生变化时需要执行 `npm run init`。

4. 启动开发环境：

```bash
npm run dev
```

你也可以一条命令启动数据库并进入开发模式：

```bash
npm run dev:local
```

如果使用 Neon / Vercel 这类托管数据库，建议同时配置：

- `DATABASE_URL`: 应用运行时连接字符串，可使用池化连接
- `DIRECT_URL`: Prisma migration 直连字符串，建议使用非池化直连

管理员账号变更（修改 `.env` 中 `ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD`）后，请执行：

```bash
npm run admin:sync
```

5. 访问：

- 用户端: `http://localhost:3000`
- 管理后台: `http://localhost:3000/admin/login`

## 数据库常用命令

```bash
npm run db:up
npm run db:down
npm run db:logs
npm run db:ps
npm run admin:sync
npm run codes:sync
```

## 激活码 TXT 快照

- 默认文件路径：`./data/activation-codes.txt`
- 每次后台批量生成激活码后自动刷新
- 激活码失效（`used/expired/disabled`）会自动从该文件移除
- 如需手动重建可运行：`npm run codes:sync`

## 默认管理员

- 邮箱：`ADMIN_SEED_EMAIL`（默认 `admin@example.com`）
- 密码：`ADMIN_SEED_PASSWORD`（默认 `ChangeMe123!`）

请上线前强制修改。

## 目录结构

```text
app/
  (public)/page.tsx
  (public)/redeem-form.tsx
  session/[sessionId]/page.tsx
  session/[sessionId]/session-client.tsx
  admin/login/page.tsx
  admin/(protected)/layout.tsx
  admin/(protected)/codes/page.tsx
  admin/(protected)/sessions/page.tsx
  api/redeem-code/route.ts
  api/session/[sessionId]/route.ts
  api/admin/login/route.ts
  api/admin/logout/route.ts
  api/admin/codes/route.ts
  api/admin/codes/generate/route.ts
  api/admin/sessions/route.ts
  api/webhooks/sms/route.ts
lib/
  api/route-helpers.ts
  auth/
  core/
  db/prisma.ts
  repositories/
  services/
  sms/5sim-client.ts
  sms/provider.ts
  sms/provider-registry.ts
  validators/schemas.ts
prisma/
  schema.prisma
  seed.ts
scripts/sms-smoke.ts
scripts/init.sh
Dockerfile
```

## 核心状态机

### activation_code.status

- `unused`
- `reserved`
- `used`
- `expired`
- `disabled`

说明：只有会话进入 `code_received` 才会把激活码置为 `used`。若会话超时/失败/取消，会自动回退为 `unused`。

### sms_session.status

- `pending`
- `number_acquired`
- `waiting_sms`
- `code_received`
- `timeout`
- `failed`
- `cancelled`

## API 列表

### 用户接口

- `POST /api/redeem-code`
- `GET /api/session/:sessionId`
- `POST /api/session/:sessionId/start`
- `POST /api/session/:sessionId/change-number`

### 管理接口

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `POST /api/admin/codes/generate`
- `POST /api/admin/codes/check`
- `POST /api/admin/codes/invalidate`
- `POST /api/admin/codes/restore`
- `GET /api/admin/sms/balance`
- `GET /api/admin/codes`
- `GET /api/admin/sessions`

### Webhook

- `POST /api/webhooks/sms`

### Cron

- `GET /api/cron/daily-maintenance`

## 统一 JSON 响应格式

```json
{
  "success": true,
  "code": "OK",
  "message": "OK",
  "data": {},
  "requestId": "uuid",
  "timestamp": "2026-04-16T12:00:00.000Z"
}
```

## 接入 SMS 说明

- 当前默认国家：`vietnam`（越南），号码前缀：`+84`
- `SMS_API_BASE_URL` 默认 `https://5sim.net/v1`
- 号码申请：`GET /user/buy/activation/:country/:operator/:product`
- 状态查询：`GET /user/check/:id`
- 完成会话：`GET /user/finish/:id`
- 取消会话：`GET /user/cancel/:id`
- 余额查询：`GET /user/profile`

`.env.example` 中与接码相关的关键变量：

- `SMS_API_KEY`：5sim token
- `SMS_PRODUCT_CODE`：业务产品标识，默认 `claudeai`
- `SMS_COUNTRY_NAME=vietnam`
- `SMS_COUNTRY_LABEL=越南`
- `SMS_COUNTRY_PREFIX=+84`
- `SMS_OPERATOR=any`
- `SMS_MAX_PRICE`：可选，只有在 `SMS_OPERATOR=any` 时更有意义

### 冒烟测试

先检查余额、国家前缀和当前产品库存：

```bash
npm run sms:smoke
```

如果还没填真实 token，这个脚本仍然会返回公开的国家前缀和库存信息，只是不会继续查询余额或真实买号。

如果想实际买一个号码再立刻取消做联调测试：

```bash
SMS_SMOKE_BUY=1 npm run sms:smoke
```

这会输出：

- 当前余额
- 当前国家公开前缀列表
- 当前产品在越南的库存和价格
- 可选的一次真实买号结果

### 页面联调流程

1. `cp .env.example .env`
2. 在 `.env` 填入真实的 `SMS_API_KEY`
3. 启动数据库：`npm run db:up`
4. 初始化：`npm run init`
5. 启动开发环境：`npm run dev`
6. 打开 `http://localhost:3000`
7. 输入一个可用激活码
8. 点击“开始接收验证码”
9. 页面拿到手机号后，在目标站点选择越南区号 `+84` 并提交号码
10. 回到会话页等待验证码，必要时使用“换号”

### 关于当前默认产品

- 当前默认 `SMS_PRODUCT_CODE=claudeai`
- 我在 2026-05-05 用 5sim 公开价格接口核对过 `vietnam/claudeai`，返回库存 `count: 0`
- 这意味着如果你的目标仍然是 `claudeai`，越南 `+84` 号码在当时没有现货；平台代码可以运行，但买号可能失败
- 如果你只是先验证整条链路是否通，可以暂时把 `SMS_PRODUCT_CODE` 改成一个在越南有库存的产品，等流程跑通后再切回目标产品

## 生产建议

- 将内存限流替换为 Redis 限流
- 使用队列/Worker 解耦短信轮询任务
- 管理员鉴权升级为双因素认证 + RBAC
- 审计日志导出到 ELK/ClickHouse
- webhook 增加签名验签与重放防护

## Vercel + Neon 说明

- Vercel 构建命令使用 `npm run vercel-build`
- 该命令会执行 `prisma migrate deploy`，因此生产环境必须能连上 PostgreSQL
- 如果 `DATABASE_URL` 使用了池化连接，建议额外设置 `DIRECT_URL` 为 Neon 的直连字符串，避免迁移阶段报错
- 若只想先验证前端部署，也可以暂时把 Vercel Build Command 改为 `prisma generate && next build`，等数据库环境变量确认无误后再恢复
- 项目内置每日定时任务（`/api/cron/daily-maintenance`），在 Vercel 中由 `vercel.json` crons 自动触发
- 建议配置 `CRON_SECRET`，并确保 Vercel 项目也配置同名环境变量

## 自动补码与邮件提醒配置

可选环境变量：

- `AUTO_GENERATE_UNUSED_THRESHOLD`：unused 低于该值触发自动补码（默认 `20`）
- `AUTO_GENERATE_BATCH_SIZE`：每次自动补码数量（默认 `400`）
- `LOW_BALANCE_THRESHOLD_USD`：低余额阈值（默认 `1`）
- `MAIL_ENABLED`：是否启用邮件（`true/false`）
- `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` / `MAIL_SMTP_SECURE` / `MAIL_SMTP_USER` / `MAIL_SMTP_PASS`
- `MAIL_FROM` / `MAIL_TO`

邮件启用后：

- 自动补码会附带 `txt` 发送本次生成的激活码列表
- 余额低于阈值会发送告警邮件
