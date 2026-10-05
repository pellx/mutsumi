# M03 成熟聊天核心部署与验收记录

2026-10-05，监督设计与独立验收；应用源代码仅由 ChatGPT 认证 Codex CLI 配置的 gpt-6-luna 编写。每个实际文件修改均立即单文件提交，包含随后被验收拒绝的中间草稿。本记录随实际验收更新，不能把依赖安装等同于完整功能通过。

## 已部署并验证

独立 AstrBot 4.28.2（AGPL-3.0-or-later），Python3.12.14，运行目录 D:/mutsumi-runtime/astrbot。官方 wheel SHA256 `2d3b5db74da5b5c1aa7e1b5990b3ab4cb5569bc8e6bb331b54ce3d154b1b3530`，实际 pip check 通过。桌面音频/分离/对齐/TTS 环境保持独立。当前项目位置 E:/mutsumi/mutsumi；历史文档的 D:/voicebot 不能当本机路径。

启动器 tools/chat-core/run_astrbot.py 固定框架版本、127.0.0.1、强随机后台密码、无消息平台和回退模型、截轮历史压缩。独立供应商子类固定既有 OhMyGPT gemini-3.8-flash，仅一次请求，SDK max_retries=0，原异常立即上抛；不修改供应商安装源码。15项结构检查及实际安装 OpenAI SDK MockTransport 4项检查通过，400/429/500各只发一次，异模型覆盖在请求前拒绝；这些是合成输送检查，没有云调用。实际进程互斥检查返回 runtime_already_running。

服务本机地址 http://127.0.0.1:6185/。后台密码/API令牌保存在运行目录私有配置，未进入 Git。Chat API令牌仅 chat scope；本版本使用 X-API-Key，普通用户ID不能冒充默认后台 astrbot 用户。实际安装版本 OpenAPI/源码核对了用户名、session、persona、SSE、知识库及插件接口，未照旧文档猜字段。

原创 Mutsumi 人格来自 docs/personas/mutsumi-system-prompt.md：温柔安静、具体、有自己的看法，中文自然口语，避免动作/表情控制标签；真实记录、角色虚构、模型情绪与背景候选分开。Gemini只生成正文，Jev表达保持独立且当前 unavailable，TTS未在本轮请求，不宣称已播放。

三次真实 Gemini 文本请求均 HTTP200/SSE end：自我介绍约6547ms；合成验收情境“蓝色杯子放窗边”约3969ms；关闭核验的服务进程、重新启动后，同一会话询问杯子颜色/位置约4703ms，回答“是蓝色的杯子，放在窗边。”。后两项是明确合成场景，证明近期会话跨进程持久化，不是用户私人事实或长期记忆验收。原始 SSE 与实际用时保留运行目录 qa/，不上传。

## 正在完成的独立验收

chat.mjs 草稿因原生 SSE plain 事件、候选情绪状态和空 uncertainty 列表兼容问题被独立检查拒绝，不能当已接通的音频生产入口。修复采用相同 Luna CLI，一次一文件；完整 stream EOF/end、正文与工具/推理分离、输入和响应预算、现有目录不覆盖、严格数据投影均须通过后合入。

Mem0 OSS2.2.1（Apache-2.0）与 FastEmbed0.8.1 已独立安装在 D:/mutsumi-runtime/memory；pip check 通过。仅本地 Qdrant 持久化、禁用遥测/远端模型下载、infer=False 明确写入。中文 BAAI/bge-small-zh-v1.5：Qdrant/bge-small-zh-v1.5 固定修订 `46fbe35fd4374a00fee7de77dfddaeb6dd6a2c59`，5文件95221432bytes，实际离线输出512维有限向量。文件哈希清单 model-manifest.json 留本地，尚不冒充通用硬件结论。

真实安装 Mem0 的独立合成事实检查通过：写入薄荷茶、仅同用户检索、跨用户0结果、修正为茉莉茶、第二Python进程读回修正内容与来源、删除后活动检索0结果。审计 history.db 保留历史文字，删除不能声称安全擦除全部日志/备份。可选BM25/spaCy模型未安装，本次仅语义检索。该证明尚不是 AstrBot 已使用长期记忆；薄服务和插件桥接独立验收中。

DDGS9.16.0 与 yt-dlp2026.8.19 已安装在隔离 AstrBot 环境，pip check 通过。一次公共查询以 DDGS/bing 实际返回3来源（官方知识库文档、官方wiki、官网），无API Key、无用户私人上下文；插件接线尚未验收。视频先提供明确字幕能力，不能把字幕获取称为理解画面或听过声音。失败/字幕不可用需实际报告，不造工具成功。

知识库将复用 AstrBot原生组件与上述本地嵌入服务，独立于个人记忆。尚未创建或验收知识库资料。完整任务还包括真人已处理JSON的有界投影到人格回复、明确记忆命令及跨会话召回、原生知识库带来源、真实搜索/失败、视频能力边界和使用文档。

## GitHub 同步

用户本轮明确要求完成任务后上传，覆盖历史 D29 的暂时仅本地提交。现有 origin 为 https://github.com/pellx/mutsumi.git；git push --dry-run origin main 已成功，验证现有 Git 凭据有写权限，未实际推送。监督已扫描528历史blob，已配置实际密钥匹配0，.env/data/.runtime跟踪路径0；最终推送前补扫新增提交。没有从浏览器复制会话令牌。
## 已完成子任务：JSON/纯文本进入人格回复（2026-10-05）

客户端最终主提交 c246c31。27项独立检查全部通过、云调用0：真实原生 SSE/plain 和完整 EOF/end、跨块 end 后非法事件拒绝、UTF8/CRLF、组合消息预算、getter/稀疏数据拒绝、候选状态及空不确定性、实际第03段展示JSON的有界投影、已有输出不改动、真实本地HTTP挂起响应截止。源代码只在 Luna CLI 中修改，监督 QA 位于 ignored .runtime/qa/astrbot-chat-checks.mjs。现有 TypeScript构建及287tests/19suites回归本轮重新通过。

通过最终客户端再作两次实际 Gemini 请求，不是手工伪造回复或mock：纯文本按原创人格回应，约7773ms；第03段真人录音已经融合的整体场景/原文/逐句语气 JSON 投影进入相同核心，约7475ms，回复认为原文类似《小王子》开头并自然继续对话。没有发送本地文件路径、完整字头/占用数组、原始音频或API密钥；候选与未知保留，不把故事内容写成用户事实。这里验证数据到回复的接线，不证明该文学联想经过外部资料核实。两次结果都明确 expression=unavailable/jev_not_connected，tts=unavailable/not_requested，未声称情绪表达或音频已生成。

实际输入/结果与测得请求时间存于 ignored data/acceptance/m03-chat-client-live-001；计时是本机真实请求耗时，非语音字时间。角色系统仍缺 Mem0服务→AstrBot桥接、原生KB配置、搜索/视频插件启用的完整验收，不能称完整机器人已经完成。用户要求先完成当前小子任务并报告状态，监督正在收尾已启动的记忆服务修复，不将后续尚未启动任务当已完成。GitHub仅预检，尚未实际推送。
## Mem0 服务已验收，聊天桥接尚在实施

2026-10-05，主仓库 a8076c3/647b749/089e512 分别保存原始单文件交付、路由/读回修复、重复取消修复。最初合法请求422，独立检查发现局部Pydantic模型的未来注解解析问题；第一轮取消修复仍在AnyIO重复取消下释放锁，监督用真实ASGI调用证实后续检索HTTP200早于物理写入完成。最终 AnyIO shield + asyncio shield 等待实际线程完成，保持同一操作锁，关闭数据库与释放进程锁前完成操作；没有假称线程写入可取消。

30项独立合成对象检查通过（包括27协议/作用域/确认/边界/实际读回检查、3取消生命周期检查）；不证明语义召回质量。随后从真实已安装Mem0和本地嵌入启动服务 http://127.0.0.1:6186/，12次真实HTTP操作验证明确写入、跨用户0召回、候选排除、确认后可检索、保留候选来源、修正、删除及活动检索为空。原生OpenAI SDK使用Bearer/default base64实际获得512维有限向量，usage没有伪造。没有云LLM推理或API调用。

只停止经端口和命令行核验的项目服务，从主仓库源码重新启动，再用3次HTTP操作读回重启前合成事实及实际来源、删除并确认0召回。实际服务检查共15次memory HTTP操作 + 1次本地embedding SDK请求，全部本地，重启验收事实已从活动检索删除。仍有审计历史，不声称安全擦除。日志、配置令牌、QA私有记录位于 D:/mutsumi-runtime/memory，未提交。

目前运行主仓库服务，Luna正在实施 AstrBot桥接插件。以上验收不能宣称 Mutsumi 已在聊天中自动检索长期记忆。候选/确认/修正/忘记命令、跨会话与重启后的实际人格回复将在插件接入后单独验收。