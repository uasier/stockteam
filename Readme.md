# 股票小分队

A 股协同观察、持仓记账和跟投交流。网页、macOS、Windows 和 Android 共用这一套界面，接口由 Django 提供。

对外地址是 <https://stockteam.uasier.com>。

## 本地启动

先启动数据库：

```bash
docker compose -f backend/docker-compose.yml up -d
npm run migrate
npm run api
```

另一个终端启动页面：

```bash
npm run dev
```

打开 <http://127.0.0.1:1420>。开发时 Vite 会把 `/api` 转到 `http://127.0.0.1:40301`。

MySQL 在 `127.0.0.1:40310`，库、账号和密码都是 `gp_circle` / `gp` / `gp_circle`。Redis 在 `127.0.0.1:40311`。要让接口使用 Redis，设置 `REDIS_URL=redis://127.0.0.1:40311/0`。

没有 Docker 时，可以把 `backend/.env` 里的 `GP_DB` 设为 `sqlite`，并去掉 `REDIS_URL`。

## 首次使用

库里还没有用户时，用邀请码 `ADMIN` 注册。这个账号会成为管理员，之后可以发放一次性邀请码，也可以保存 DeepSeek API Key。

## 主要功能

- 邀请码注册，管理员发放邀请码
- 小群共享的观察列表，首位记下自选价，其他人可以跟进
- 买入、卖出，以及跟买、跟卖
- 评论、关注，以及圈子动态
- 打开股票时根据公开标题整理风险备忘
- 跳转到同花顺个股页

更细的接口说明在 `backend/README.md`。
