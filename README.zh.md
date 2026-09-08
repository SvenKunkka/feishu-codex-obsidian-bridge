# 飞书 ↔ Codex ↔ Obsidian 桥

在飞书私聊里提问或发送社媒链接，交给本机 Codex 处理，结果保存为 Obsidian Markdown；由你校正、勾选确认后再复用。

[English](README.md) · [使用说明](docs/USAGE.md) · [安全边界](SECURITY.md) · [上游归属](NOTICE.md)

当前版本 **0.2.0**：新增微信公众号、GitHub、Kickstarter、Indiegogo 页面采集。详见 [更新记录](CHANGELOG.md)。

这是基于 [lark-channel-bridge](https://github.com/ddcarolyn/lark-coding-agent-bridge) 的非官方扩展，固定使用 npm **0.7.0**。仓库包含完整的自定义接入补丁和模块，不含作者正在使用的配置、聊天记录或知识库。

## 功能

- 问答自动保存到一个平面目录，不建立复杂目录树。
- 笔记顶部“已确认”控制复用；只用当前有效的人工版本，不从历史对话补回已删除结论。
- Browser Use 采集抖音、小红书、知乎、微博、普通网页、YouTube、Bilibili 的可访问正文、简介和字幕；新增微信公众号、公开 GitHub 页面、Kickstarter、Indiegogo，不使用 OpenCLI。
- 相同链接默认返回已有笔记；明确要求刷新才更新来源与互动快照，不覆盖人工摘要和补充。
- 支持收藏搜索、数量统计、平台/主题/时间筛选、已确认资料综合分析和同口径互动变化。
- 应用创建者私聊发送文件/目录路径即可打开；支持句子内路径和已挂载 NAS 路径，打开操作不存为问答。
- 处理期间添加 `CheckMark`，完成/失败/取消后移除同一个表情；收到撤回事件后取消对应排队或运行任务。

这里没有另设服务器、定时采集任务或云同步服务。采集与索引由桥接进程执行；Obsidian 关闭也能写入 Markdown。桥接停止时不采集，下次启动对账离线修改。撤回只能停止后续工作，不能撤销已经产生的外部效果。

## 重要边界

**这是个人桌面助手，不是经过安全隔离的多人机器人。** 上游默认权限是 `full`，对应 Codex 的 `danger-full-access`；打开文件没有目录白名单。请维持仅本人使用，先阅读 [SECURITY.md](SECURITY.md)。不要在未做额外隔离审查时向群或其他用户开放。

完整桌面链路面向 macOS；需要 Node.js **22.16+** 且内置 SQLite 支持 FTS5（官方 22.16 起的构建支持；更早 22.x 即使有 SQLite 也可能缺少 FTS5）、已登录的 Codex CLI、Obsidian 本地库，以及能连接 Chrome 的 [Browser Use browser-harness](https://github.com/browser-use/browser-harness)。此处要求提供 `new_tab`、`js` 等 Python helpers 的 harness，不是任意同名工具。`yt-dlp` 是可选的字幕补充依赖。

上述平台都有适配器，但不是所有链接都保证成功。登录、验证码、删除、地区限制、缺失字幕和页面改版会造成失败或部分采集；不会把视频简介冒充完整视频内容。

新增平台范围：

- **微信公众号**：`mp.weixin.qq.com/s` 长短文章链接；保存可见正文、公众号名称和发布时间。付费预览标为部分内容，验证页和删除页不保存，不转录嵌入视频。
- **GitHub**：公开仓库 README、可见文件、Issue/PR/Discussion 主帖、单篇 Release 和 Wiki。不会克隆整个仓库、执行代码、下载附件或读取私有/内部仓库；回复、评审和完整讨论不在主帖采集范围。
- **Kickstarter / Indiegogo**：可访问的项目故事及已适配的独立更新/FAQ 等子页。不会把子页合并进项目首页；图片文字、未展开内容和视频未读取时说明限制，不绕过安全验证。众筹承诺不是已交付事实。
- 星标、Fork、筹款/目标/支持人数等可读字段只进入独立“页面信息快照”，不混成点赞/播放量，不做融资增长推断。
- 原来存为 `web` 的旧笔记通过索引识别新平台，保留原文件、来源标识、人工校正与确认状态；来源别名冲突会提示核对，不自动选一篇覆盖。

## 安装与首次启动

```sh
git clone https://github.com/SvenKunkka/feishu-codex-obsidian-bridge.git
cd feishu-codex-obsidian-bridge
npm ci
npm run build
npm test
cp .env.example .env
```

编辑 `.env`，把 `FEISHU_WIKI_VAULT` 设置为自己的库路径。凭据使用交互向导配置，不写进仓库。

```sh
node -v
codex --version
codex login status
browser-use --doctor
node bin/feishu-codex-obsidian-bridge.mjs --help
npm start -- run --profile codex --agent codex
```

二维码/链接向导由你本人完成；前台进程正常不会退出。连接后发一句话或一个链接，再去 Obsidian 检查。后续前台启动仍用最后一条命令。扩展目前只接入 **`codex` profile**，不宣称多个 profile 各自拥有隔离的 WIKI。

发布版默认使用独立的 `LARK_CHANNEL_HOME`，不直接读取全局安装机器人的配置；构建也不会修改全局安装或重启现有机器人。同一飞书应用不要同时运行两个实例。迁移现有应用必须有意选择旧配置并先停止旧实例，不能把新旧服务一起启动。

上游的服务命令仍会透传，但使用独立的系统服务名 `feishu-codex-obsidian-bridge.bot`，不操作原上游服务。本仓库不会自动安装或迁移系统服务。若要常驻，请先阅读上游 README 的服务说明，保持 checkout 路径稳定，不使用临时 `npx` 路径。

## 配置与日常使用

默认笔记位置是 `~/Documents/Feishu-WIKI`；私有索引和审核账本位于 `~/.local/share/feishu-codex-obsidian-bridge`。不要把审核账本当成随时可删的缓存：它记录历史确认与退役关系。

本版刷新备份使用硬链接，**库与状态目录应放在同一文件系统卷**。若库在外置盘，应同时配置状态目录；跨卷刷新可能因 `EXDEV` 失败，不会当作更新成功。

`.env` 始终从仓库根读取，已有环境变量优先。所有配置项见 [.env.example](.env.example) 和 [英文配置表](README.md#configuration)。社媒摘要模型默认 `gpt-5.6-sol` / `medium`，需自己的账号及 CLI 支持；聊天模型仍由上游 profile 单独设置。

飞书聊天记录的个人身份访问需要另行授权，创建机器人并不等于获得全部个人聊天记录权限。

具体收藏命令、勾选审核和排障顺序见 [使用说明](docs/USAGE.md)。

## 代码与验证

`runtime/` 是可维护模块；`patches/` 保存对上游的集成变更；`scripts/` 和 `bin/` 负责构建、启动；`tests/` 使用合成样本和临时目录。构建核验固定上游文件哈希，严格应用补丁，检查结果哈希与语法，产出本地 `dist/cli.js`；不会修改全局 npm 包。

公开版不包含聊天样本、飞书凭据、个人路径、Obsidian 内容、审核账本、日志或部署备份。自动化测试通过不代表每个平台当前都已完成真实登录态验收。升级上游时必须重新审查补丁，不能强套其他版本。

MIT 许可；保留原桥接项目归属，见 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md)。
