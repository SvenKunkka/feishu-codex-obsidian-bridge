# 使用说明 / Usage

## v0.2.0 新增页面

可以直接发送微信公众号文章、公开 GitHub 仓库/文件/单篇 Issue、PR、讨论、Release、Wiki，以及 Kickstarter / Indiegogo 项目链接。只有可见正文被采集；需要登录、验证码、已删除或未支持的子页会明确报错，不当作成功收藏。

示例筛选命令：`/收藏统计 本周 微信公众号`、`/收藏 GitHub 工具`、`/收藏分析 Kickstarter 键盘`、`/收藏 Indiegogo`。`indigogo` 作为自然语言平台名称的拼写变体也可识别，但网页域名应使用正式的 `indiegogo.com`。

GitHub 星标/Fork、众筹金额/目标/支持人数等是采集时的页面信息，独立显示在机器来源区；未知不补零，也不据此自动计算增长。主帖不等于完整讨论，众筹页面承诺不等于实际交付。老版本已收藏的相同链接会沿用原笔记，不重建已确认内容。

## 收藏、统计与复用

| 发送给机器人的内容 | 行为 |
|---|---|
| 一个受支持的社媒或网页链接 | 保存可访问文字、摘要和来源，等待确认 |
| “总结一下”加链接 | 先收藏，再基于本次未审核来源回答 |
| 再次发送相同链接 | 返回已有笔记，不覆盖人工内容 |
| “更新这篇”加链接 | 刷新来源与互动快照，保留人工区 |
| “刷新互动数据”加链接 | 记录当前数字，与之前可比较的快照计算差值 |
| “这周收藏了多少篇” | 按北京时间统计数量、平台、主题及确认状态 |
| “哪些还没确认” | 列出待确认或需要重新确认的收藏 |
| “找一下之前收藏的键盘评测” | 查找候选笔记，不把未审核内容当成已确认事实 |
| “根据我确认过的资料，整理键盘常见问题” | 使用有效已确认人工区，附来源进行综合 |

命令：`/收藏帮助`、`/收藏 键盘`、`/收藏统计 本周 小红书`、`/收藏分析 键盘`、`/互动数据 链接`。

综合分析最多使用 12 篇已确认资料，每篇最多 8000 字、总计最多 30000 字；超出时明确报告采用范围。数量统计不受 12 篇限制。不同平台的点赞/播放数字不合成为统一热度排名；未知不是零，近似值保留标记，单次快照不称为增长。

## Obsidian 审核

1. 打开配置的库，找到新笔记。
2. 问答修改“答案”；社媒修改“摘要与要点”，必要时填写“我的补充”。
3. 核对来源、适用范围和日期，再勾选顶部唯一的“已确认”。
4. 对已确认人工区再次修改后，需要重新确认。社媒 v2 会自动取消勾选并提示；问答先取消保存、核实后重勾保存。

原文摘录和互动数字不是已审核知识；来源区刷新不覆盖人工区。同题替代版本只有经过审核才生效；取消确认、删除或失效后不应继续复用。审核账本保留退役历史，不要作为缓存删除。

## 文件打开

应用创建者私聊可以发送：

```text
~/Documents/example.pdf
请打开这个文件夹：~/Documents/Reference
\\ExampleNAS\Shared\Reference
```

这里只对本机存在的路径调用 macOS 默认打开程序；NAS 需已经挂载。路径在句子内含空格时，用引号包裹更明确。不要发送不希望执行或打开的应用/主动内容。此操作不保存为问答。

## 运行与排障

前台启动：`npm start -- run --profile codex --agent codex`。保持该进程运行；Obsidian 窗口可以关闭。配置保存在私有状态目录，不在 GitHub 中。

如果不回复或没有入库，按顺序检查：

1. 前台进程是否仍在运行，终端有没有断线/异常；不要在同一 app 上再开第二个实例。
2. 飞书 `/status` 是否正常，当前 profile 和 agent 是否符合预期；查看相关时间段日志，分享前脱敏。
3. `codex login status`，模型是否对当前账号和 CLI 可用。聊天模型与收藏摘要模型分别配置。
4. 只有链接采集失败时运行 `browser-use --doctor`；在 Chrome 亲自完成对应平台登录或验证，再重试。
5. 核对 `FEISHU_WIKI_VAULT` 是否就是 Obsidian 当前打开的库，目录是否可写；不要删除审核账本来排障。
6. 只有复用不生效时，检查顶部是否勾选、人工区是否改过、是否需要重新确认，以及资料是否仍适用。

不要把“读到了标题/简介”当作已读完整视频；登录页、已删除页和空页面不会作为成功收藏。缺少字幕时会明确标记部分采集。

## English summary

Send a public/social URL to collect it. Re-sending returns the existing note; explicitly request a refresh to update the source snapshot. Edit the curated answer/summary in Obsidian and check the unique top approval box before reuse. Modifying confirmed content requires renewed approval. Search and statistics can discover unconfirmed notes, but approved-only synthesis cannot treat them as confirmed evidence.

Use `/收藏帮助` for commands. Keep the bridge running for collection and reconciliation; there is no independent scheduled service. For problems, check the bridge, Codex login/model, Browser Use connection/login, vault path, then approval state—in that order. Do not erase the approval ledger.
