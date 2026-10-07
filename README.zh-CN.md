# Vox-Lingo

[English](README.md)

面向八岁初学者的本地语言学习应用，包含实时语音、家长备课、可编辑教案、可视练习和持久化学习证据。Windows 启动脚本现使用 Vox-Lingo 名称。

## 启动与停止

需要 Node.js 24 或更高版本。

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

打开[本地应用](http://127.0.0.1:3212)，服务仅监听本机。Windows 可使用 `Start-vox-lingo.cmd`、`Stop-vox-lingo.cmd` 和 `Restart-vox-lingo.cmd`。关闭浏览器不会停止后台服务；终端启动可用 Ctrl+C 停止。

非密钥配置按进程环境变量、`.env`、代码默认值的顺序读取。`.env.example` 说明 `KI_PORT`、`KI_DATA_DIR` 和模型参数。启动脚本读取 Windows 用户／系统密钥；新增环境变量后，已有终端通常需要重新打开。

## 三项独立语言设置

点击齿轮打开设置。

| 设置 | 可选语言 | 生效时间 |
| --- | --- | --- |
| 界面语言 | 英语、德语、简体中文 | 立即预览，点击“保存语言设置”后持久化 |
| 教学语言 | 英语、德语、简体中文 | 保存后开始的新请求和新课程 |
| 目标语言 | 英语、德语、日语、韩语、法语、西班牙语 | 保存后切换内容分区，并用于新课程 |

默认组合为 **德语界面／德语教学／英语目标**。内部代码为 `en/de/zh-CN` 和 `en/de/ja/ko/fr/es`；语言设置输入边界支持 `cn/jp/kr` 别名。

取消／完成、关闭按钮、Escape、点击遮罩或刷新都会丢弃未保存预览。恢复默认也需要保存。保存失败保留草稿和预览；遇到窗口版本冲突，需要重新读取已保存值。语言与服务商设置有独立的保存按钮，不会互相提交草稿。

上课期间可以保存语言设置，不会重连音频或改变当前题目。当前课程及中断后恢复仍采用开课时的教学／目标语言快照。切换分区后，仍能看到标明语言的“继续原课程”入口。只允许一节进行中的课程。

切换语言**不会翻译已有主题、教案、总结、答案或聊天正文**。固定界面文字随界面语言变化，保存内容保留原文。家长聊天跟随家长输入语言；备课录音的“自动／中文／英语／德语”识别提示也继续独立存在。

## 主题与教案

每种目标语言独立保存主题、课程历史、统计、复习队列和学习证据。空分区需要通过备课创建内容；旧的初始主题仍只属于英语分区。

新开课前，必须准备并保存匹配主题版本、目标语言和已保存教学语言的教案。服务端拒绝缺失、过期或语言不匹配的教案。三种教学语言的教案分别保留；主题变化后旧教案标为过期，不会删除。恢复旧课使用原快照。

家长聊天示例：
- “把所有英语主题的标题和学习目标翻译成中文。”只修改指定说明字段，不改词汇和学习证据。
- “根据英语颜色主题创建日语学习版本。”新建独立日语主题，不复制进度或原教案。

“全部”默认指当前目标语言分区，跨分区必须明确来源。支持超过 8 个主题，每批最多 6 个，每种目标语言最多 60 个主题。界面显示进度并允许取消。所有批次和最终回复完成后统一事务提交；供应商错误、取消和版本冲突均不部分更新。重启后未完成操作标为失败，可重新发起。已有对应语言版本时应明确要求更新，不再重复创建。

教学语言和目标语言相同时使用定义、图片或情境提示，不把同一个词翻译成自身。口语回忆题要求目标语言答案；不确定转写不会被默认为正确。

## 服务商与密钥

四类既有服务继续独立配置：

| 职责 | 服务商 | 代码默认值 |
| --- | --- | --- |
| 实时语音和字幕 | OpenAI / Gemini / ChatGPTPlus | OpenAI `gpt-live-1`、`marin`；ChatGPTPlus `gpt-live-1-codex`、`sol` |
| 课堂决策和总结 | OpenAI / DeepSeek | OpenAI `gpt-6-luna`、low、fast |
| 备课录音转写 | OpenAI / Gemini | OpenAI `gpt-transcribe` |
| 家长聊天、主题和教案 | OpenAI / Gemini / DeepSeek | OpenAI `gpt-6-luna`、high、auto |

上表是应用配置默认值，不保证账户有访问权限。模型、声音和推理参数来自环境；设置界面只编辑服务商，保存在 `data/model-settings.json`。课程、备课、教案生成和转写期间仍禁止切换服务商，但允许保存语言。环境参数变化需要重启。OpenAI 备课固定使用 `auto`，只有 OpenAI 课堂后台读取 `OPENAI_BACKEND_SERVICE_TIER`。

密钥只读取进程／系统环境变量 `OPENAI_API_KEY`、`GEMINI_API_KEY`、`DEEPSEEK_API_KEY`、`PLANBRIDGE_API_KEY`，也兼容既有小写变量名。`.env` 中的密钥会被忽略。不新增密钥输入框、跨供应商自动回退或密钥持久化。缺少密钥时仍可查看本地记录。

OpenAI Live 使用 WebRTC 和服务端控制连接；Gemini 使用原生 SDK WebSocket 和本地 PCM 通道。两者接收冻结的课程语言上下文；Gemini 转写提示使用去重后的 BCP-47 代码。字幕不自动翻译。文本与备课转写适配器继续保持各自端点、参数和密钥隔离。

### ChatGPTPlus / GPT Live Codex

在设置中把实时对话服务商选为 **ChatGPTPlus** 并保存。尚无已保存服务商选择时，可通过 `LIVE_MODEL_PROVIDER=chatgptplus` 设定初始选择；重启时 `data/model-settings.json` 中已保存的选择优先。URL、模型和 voice 从项目根目录 `.env` 读取，进程环境变量优先：

```dotenv
PLANBRIDGE_BASE_URL=http://miniserver:8787/v1
PLANBRIDGE_LIVE_MODEL=gpt-live-1-codex
CHATGPT_CODEX_VOICE=sol
```

支持的声音为 `arbor`、`breeze`、`cove`、`ember`、`juniper`、`maple`、`sol`、`spruce`、`vale`。模型必须为 `gpt-live-1-codex`，网关地址必须以 `/v1` 结尾。`PLANBRIDGE_API_KEY` 继续仅配置在 Windows 用户／系统环境变量中，随后用 `Restart-vox-lingo.cmd` 重启；启动脚本读取密钥但不写入磁盘。设置界面的模型、voice 和服务器地址只读。

实现移植自只读的 KI-Englischlehrerin：认证预检、client delegation 创建会话、浏览器 WebRTC 音频、唯一服务端 sideband 和本地 SSE 字幕。原生 DataChannel 不执行课堂任务。指令等待原生确认；口头反馈遵守 500 UTF-8 字节上限，过长时由选定的课堂后台缩短并保留课程冻结的教学／目标语言。关闭必须确认，未确认时保留 session ID，供明确重试或重启后清理。课堂后台、Teacher、录音转写仍独立配置。

可选命令 `node scripts/smoke-chatgptplus.js --run` 使用合成浏览器音频创建一次真实订阅 Live 会话，检查 WebRTC、sideband、指令确认、口头输出字幕和确认关闭，不读取学习数据。需要浏览器测试使用的 Playwright Chromium，并会消耗订阅用量。`check:api` 对 ChatGPTPlus 只检查网关就绪状态，不创建 Live 会话。

## 数据与升级

默认 `data/` 目录包含 `learning.sqlite`、图片和服务商设置。语言偏好、版本号及批量操作状态保存在 SQLite。数据库版本为 **5**，旧英语／德语字段及练习枚举通过兼容层读取。

**升级前停止所有可能写入该数据目录的实例。** 启动时会 checkpoint 旧数据库、检查写入竞争，然后将完整目录复制到同级 `*.backup-v4-<时间>-<编号>`，再执行迁移。Windows 复制前会释放 SQLite 文件锁；检测到复制期间数据库变化时拒绝继续。这不能替代停止其他写入进程。

迁移使用事务并可重复启动。旧主题和证据仍属于英语，旧课程和教案采用德语教学。保留 ID、历史 JSON、总结、图片、删除标记和回答证据。本次验证了合成的 v4 数据目录；实施开始时本目录没有既有用户数据库。

回退时停止应用、保留升级后的目录，并使用匹配的旧程序和**完整备份目录**恢复。不要让旧程序读写版本 5 数据，也不要单独合并 SQLite 文件。备份可能含学习记录、聊天和配置，应视为私有数据。

## 验证与维护

可选的 `node scripts/smoke-languages.js --run --all` 检查已配置文本服务的中文备课、日语主题创建和中文讲解教案。该命令使用全新合成内存档案，会产生真实调用费用，不读取既有学习记录。

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

这些命令使用测试数据，不调用付费模型。浏览器测试包含真实 AudioWorklet、本地 PCM 和模拟供应商。`npm.cmd run check:api` 只检查模型访问；可选的 `node scripts/smoke-text.js --all` 会向已配置服务发送合成工具调用，可能产生费用，不读取学习记录。

另见[需求](REQUIREMENTS.zh-CN.md)、[验证记录](VALIDATION.zh-CN.md)、[已批准计划](I18N_PLAN.md)和[第三方说明](THIRD_PARTY_NOTICES.zh-CN.md)。真实儿童语音、口音／噪声、物理设备、长时间会话及 Safari/iPad 仍需单独验证。下拉选项和模拟请求通过不代表真实多语语音质量已通过。

Git 忽略本地数据、备份、密钥、依赖、构建和测试产物。本次实施未发布应用或修改远程仓库。
