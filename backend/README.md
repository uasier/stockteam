# 股票小分队接口

Python、Django REST framework、MySQL、Redis。依赖和虚拟环境由 uv 管理。桌面和手机客户端是本仓库的 Tauri 应用，开发时由 Vite 把 `/api` 转到本服务。对外域名是 <https://stockteam.uasier.com>。

本机端口登记在 `大模型项目/端口登记`。这一段属于 `gp`：

| 端口 | 用途 |
| --- | --- |
| 1420 | Tauri / Vite 开发页面 |
| 40301 | 股票小分队 API |
| 40310 | 本项目 MySQL 宿主机端口 |
| 40311 | 本项目 Redis 宿主机端口 |

## 启动

```bash
cd backend
uv sync
docker compose up -d
cp .env.example .env
uv run python manage.py migrate
uv run python manage.py runserver 127.0.0.1:40301
```

`uv sync` 会按 `pyproject.toml` 和 `uv.lock` 创建 `.venv` 并装好依赖。Python 版本写在 `.python-version`，当前是 3.12。

仓库根目录也可以执行 `npm run migrate` 建表，再执行 `npm run api`。另一个终端执行 `npm run dev`，打开 <http://127.0.0.1:1420>。

没有 Docker 时，可以把 `.env` 里的 `GP_DB` 设为 `sqlite`，并去掉 `REDIS_URL`。这样会使用 `backend/db.sqlite3` 和进程内缓存，方便本地看界面。正式数据仍应按上面的 MySQL 和 Redis 运行。

## 行情

现价和涨跌幅来自东方财富公开接口：

- `https://push2delay.eastmoney.com/api/qt/ulist.np/get`
- 失败时改用 `https://push2.eastmoney.com/api/qt/ulist.np/get`
- 东方财富没有返回时，再用新浪 `https://hq.sinajs.cn/list=`。系统代理和直连都会试一次。
- 搜索用 `https://searchapi.eastmoney.com/api/suggest/get`
- 风险备忘里的标题用 `https://search-api-web.eastmoney.com/search/jsonp`

同一只股票 20 秒内复用 Redis。成员点击「刷新行情」会跳过缓存，把新价格写回数据库。北交所 `92` 开头的代码使用 `0.` 前缀，已用 `920027` 核对过。

## 风险备忘

打开股票时先取最近的公开标题。没有 DeepSeek API Key 时，只展示标题，并写明没有做正负面判断，不会编造监管或新闻。管理员可在接口 `GET/PATCH /api/ai-key` 保存密钥；还没保存过时沿用环境变量 `AI_API_KEY`。`AI_BASE_URL` 默认是 `https://api.deepseek.com/v1`。

## 接口

- `POST /api/auth/register` 需要未使用的邀请码。库里还没有用户时，邀请码 `ADMIN` 会把这位注册者设为管理员，随后作废
- `POST /api/auth/login`、`POST /api/auth/logout`、`GET/PATCH /api/auth/me`。已登录用户可以修改用户名
- `POST /api/auth/avatar`、`DELETE /api/auth/avatar`、`GET /api/auth/avatar/<id>`。头像限 PNG、JPG、GIF、WEBP，不超过 2MB
- `GET/POST /api/auth/invites` 仅管理员
- `GET /api/stocks/search?q=`
- `GET /api/quotes?codes=`、`POST /api/quotes` 主动刷新
- `GET/POST /api/watch`、`PATCH/DELETE /api/watch/<id>`。观察列表对小群全员可见。首位加入的人记下自选价格，其他人跟进时不记录自选价格
- `GET/POST /api/holdings`、`POST /api/holdings/<id>/sell`。当前持仓对小群可见，并带回持有人；已卖出仍只看本人
- `GET /api/feed`、`POST /api/feed/<id>/follow`。加入观察、更新自选、移出观察、买卖、关注和评论都会写入动态。买卖可以跟随；观察可以跟进，跟进不记自选价格
- `GET /api/stocks/<code>`、`POST /api/stocks/<code>/like`
- `GET/POST /api/stocks/<code>/comments`、`POST /api/comments/<id>/like`
- `GET/POST /api/stocks/<code>/risk`

管理员比普通成员只多邀请码。邀请码一次性使用。没有内置管理员账号，首位管理员来自 `ADMIN` 注册。

## 验证

```bash
cd backend
uv run python manage.py test accounts circle
```

测试使用内存 SQLite，不连接 MySQL。行情和新闻请求在测试里被替掉。
