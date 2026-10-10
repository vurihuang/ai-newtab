# 在 Ego 中使用 Magpie 版 AI Homepage

本 fork 支持 OpenAI 兼容网关。选择网关模式后，无需 Anthropic API Key。
原版 Anthropic Managed Agents 模式仍可使用。

## 安装

需要 Node.js 20+，以及支持加载未打包扩展的 Chromium 浏览器。

```bash
git clone https://github.com/vurihuang/ai-newtab.git
cd ai-newtab
npx pnpm@10.11.1 install
npx pnpm@10.11.1 build
```

在 Ego 中打开 `chrome://extensions`，开启「开发者模式」，点击「加载已解压的扩展程序」，选择项目里的 `apps/extension/.output/chrome-mv3`。
如果系统文件选择器隐藏 `.output`，在 macOS 中按 `⌘⇧G`，粘贴该文件夹的完整路径。
保留项目文件夹；扩展会继续从这里加载。

## 连接 Magpie

打开新标签页，在 **Connect your model** 页面填写：

| 字段 | 配置 |
| --- | --- |
| API provider | OpenAI-compatible gateway (Magpie) |
| API Base URL | `http://127.0.0.1:3425/v1`，或你实际设置的 API 地址 |
| Gateway API key | 你的 Magpie 网关密钥；仅无鉴权的网关可以留空 |
| Model ID | 例如 `group/auto-deepseek-v4-1-flash` |

这里需要 Magpie 的 API 端口，不是 Web 管理页面端口。Base URL 一般以 `/v1` 结尾，不要追加 `/chat/completions`。

点击 **Load models** 可以读取网关的模型列表。模型输入框也允许自由输入，无需修改代码。
模型 ID 使用网关返回的原值，例如 `codex/gpt-6-astra`。不要加 Pi 中用于标识服务商的 `magpie/` 前缀。
模型必须支持 `/chat/completions` 文本请求；此版本不直接调用 `/responses` 或 `/messages`。

点击 **Save connection** 保存，再点击 **Build today's homepage** 生成。
网关模式会调用模型两次：先选页，再根据读取的网页生成首页。
生成期间需要保持 Magpie 运行，关闭新标签页不会中断后台任务。

## 自定义模型和首页

首次生成前、生成失败后和已有首页上都可以打开 **Settings**。
在这里修改网关地址、密钥、模型 ID、内容要求、排除网站和自动更新间隔。

- **Save**：保存，下一次生成使用新配置。
- **Save & rebuild**：保存后立即生成。
- **Rebuild automatically**：默认开启。首次手动生成成功后，按选定间隔刷新。
- 切换服务商会清空密钥输入框，请填写对应服务商的密钥。
- 正在运行的任务继续使用启动时的连接；排除网站列表会在读取和发送页面前重新检查。

内容要求示例：

> 用中文生成简洁的每日阅读页。优先关注 AI 工具、GitHub 项目和开发者资讯。
> 每条内容写一句推荐理由，并保留原始链接。使用浅色单栏布局。

## 数据和故障处理

浏览记录摘要、最多 8 个页面的清理后内容会发送给 Magpie 及其上游模型服务。
每页最多发送 24,000 个字符，较长页面后半部分可能不会被纳入首页。
页面使用你的浏览器登录状态，因此可能包含非公开内容；可在排除列表中添加工作系统等站点。
本地网络地址始终不能作为内容源，但可以用作模型 API 地址。

密钥保存在扩展的本地存储中，不写入项目源码。网关及上游服务的数据保留由其配置决定。

- **HTTP 401 / 403**：检查网关密钥与访问权限。
- **HTTP 404**：检查 API Base URL 和模型 ID。
- **Load models 失败**：检查 Magpie 是否运行；不支持模型列表的网关仍可手填模型 ID。
- **没有可读取的历史记录**：先在该浏览器中访问新闻、社区等站点。同一站点至少需要两次访问。
- **网页读取失败**：检查站点能否在浏览器中打开，以及排除列表是否包含它。
- **生成被截断或模型返回格式错误**：尝试其他文本模型，或调整网关里的模型输出限制。
- **浏览器或后台 worker 中断**：网关模式需重新生成；已保存的首页会保留。

## 开发验证

```bash
npx pnpm@10.11.1 typecheck
npx pnpm@10.11.1 test
npx pnpm@10.11.1 build
npx pnpm@10.11.1 extension:test
```

扩展测试使用独立 Chrome 配置、模拟网关和测试页面，不读取你的浏览记录，也不调用真实模型。
如 Chrome 不在默认路径，可设置 `CHROME_PATH`。

复制 `.env.example` 为 `.env`，填写 `GATEWAY_*`，可运行 `pnpm gateway:run`。
这会用测试浏览记录和公开页面调用真实网关。运行 `pnpm agent:verify` 验证生成结果能否渲染。
不要提交 `.env` 或任何实际密钥。
