# dsh-stock-ticker

在 DeepSeek Harness Web 界面顶部显示一条从右向左滚动的股票行情条，样式参考交易所跑马灯。股票代码、刷新频率和涨跌提醒阈值都可以在界面上修改，并写入 profile 配置长期保存。

## 功能

- 顶部整宽行情条，跑马灯从右向左循环滚动；鼠标悬停时暂停，移开后继续。
- 涨跌用颜色区分：上涨绿色、下跌红色、平盘灰色，同时带 ▲ / ▼ 标记。
- 支持指数与 A 股、港股、美股混排，一次请求批量获取（默认自带上证指数、深证成指、纳斯达克）。
- 点击任意条目弹出详情卡：今开、最高、最低、昨收、行情时间；按 `Esc` 或点击别处关闭。
- 涨跌幅超过阈值（默认 3%）的条目会轻微闪烁提醒，阈值可在设置里改，填 0 关闭。
- 行情条右侧的齿轮按钮打开设置面板：
  - **股票代码**：逗号、空格或换行分隔，最多 40 个。
  - **刷新频率（秒）**：5–300 秒，默认 15 秒。
  - **涨跌提醒阈值（%）**：0–20，默认 3，0 表示关闭。
  - 保存后立即生效，并写入 profile 的 `cordis.patch.yml`，重启后保持。
- 行情条会预留自身高度，把下方三栏整体下移，不遮挡界面内容；Windows 桌面端的原生标题栏按钮（应用 / 编辑 / 帮助）始终可见。

## 股票代码写法

| 写法 | 市场 | 示例 |
| --- | --- | --- |
| 字母代码 | 美股 / 美股指数 | `AAPL`、`TSLA`、`usIXIC`（纳斯达克）、`usDJI`（道琼斯） |
| 数字代码 + 后缀 | A 股 / A 股指数 | `600519.SH`、`000001.SZ`、`430047.BJ`、`000001.SH`（上证指数） |
| 数字或字母 + 后缀 | 港股 / 港股指数 | `00700.HK`、`HSI.HK`（恒生指数） |
| 原生前缀 | 任意 | `sh600519`、`sz000001`、`hk00700`、`usAAPL`、`hkHSI` |
| 纯数字 | 按规则推断 | 6 位数字：5/6/9 开头为沪市，4/8 开头为北交所，其余深市；4–5 位补足 5 位后为港股 |

无法识别的代码会被忽略，行情条右侧会给出提示。

## 数据来源

host 半边（`lib/index.js`）向 `https://qt.gtimg.cn/q=` 批量请求行情，GBK 解码后解析出名称、现价、涨跌额、涨跌幅、今开、高低、昨收与时间；浏览器只访问本插件的同源路由，不直接连上游，因此不受 CORS 限制。同一批代码的结果会缓存半个刷新周期，上游失败时继续展示上一次的数据。

host 路由：

- `GET /api/dsh-stock-ticker/quotes` — 当前自选股的行情快照。
- `POST /api/dsh-stock-ticker/config` — 校验并保存自选股、刷新频率与提醒阈值，返回最新快照。

两个路由都先经过 `connection.requestRejection()`，与其它 Web API 共享同一套来源校验。

## 安装

```sh
# 从本目录安装（开发）
dsh plugin install /path/to/dsh-stock-ticker
```

也可以在 agent 里用 `plugin_manager install_bundle`（target 传本地目录或 GitHub 仓库地址）。安装后行情条立即出现在 DSH 页面顶部，无需修改 `document.body` 或替换应用根节点。

`package.json` 里的 `dsh.bundle.patch` 声明 patch 文件，`dsh.client` 声明浏览器半边入口；`cordis.patch.yml` 负责把插件行插进 profile：

```yaml
- insert:
    - id: stock-ticker
      name: dsh-stock-ticker
```

## 配置

界面上的设置面板调用 `configEditor` 写入 profile 层，等价于在 `cordis.patch.yml` 里写：

```yaml
- id: stock-ticker
  name: dsh-stock-ticker
  config:
    symbols:
      - sh000001
      - sz399001
      - usIXIC
      - AAPL
      - 600519.SH
      - 00700.HK
    refreshSeconds: 15
    flashPercent: 3
```

## 实现要点

- 浏览器半边注册到 `shell.overlay`（整框浮层）。组件挂载后沿 DOM 向上找到 `[data-shell-overlay]` 的父元素即框架元素，读取它当前的 `padding-top`（Windows 桌面端等于原生标题栏高度，浏览器里为 0），把行情条定位在该高度之下，并把这个高度加上 32px 写回 `padding-top`，从而为行情条预留空间。
- 跑马灯用 `translate3d` 与 CSS `animation` 实现；轨道由两份拷贝组成，位移到 `-50%` 时正好接上，形成无缝循环。自选股太少时会把这一遍循环重复若干份直到铺满视口，避免出现空白段。
- 轮询用 `setInterval`，随 `refreshSeconds` 重建；页面重新可见时立即刷新一次。
- 提醒与详情卡都尊重 `prefers-reduced-motion`：减少动态效果时不闪烁，跑马灯改为可横向滚动。
- 所有定时器、监听器与注入的 `<style>` 都通过 `ctx.effect` 注册清理函数，组件卸载后不残留。

## 目录

```
package.json        # dsh.bundle / dsh.client 清单
cordis.patch.yml    # 插件插入行
lib/index.js        # host 半边：行情抓取、缓存、设置读写、HTTP 路由
lib/client.js       # 浏览器半边：行情条、详情卡、设置面板、样式注入
locale/{zh,en}.json # 插件显示名称与描述
icon.svg            # 插件图标
```

## 许可

MIT
