# mutsumi

情绪语音助手原型。音频输入先分析整体声音，再分离人声、转写、按停顿分句、定位句内字头并分析语气。已处理的音频 JSON 和纯文本共用 AstrBot 人格聊天核心，Gemini 生成适合 TTS 的中文正文；长期记忆使用本地 Mem0，知识库使用 AstrBot 原生组件。完整 LLM 工具循环、自定义音色和 Jev 表达仍有未验收能力。

## 当前状态（2026-10-05）

- 已有供应商无关的标注契约、严格校验、原始音频存储、FFmpeg 接入、会话存储与上下文/表达计划基础模块。
- 已有阿里云上传/ASR、OhMyGPT 音频分析，以及分离后的 Gemini 转写与 Qwen-Audio 时间适配器。Qwen-Audio 仍会改写文字，真实录音对照被拒绝，不能当作准确的强制对齐。
- 已选本地 `Qwen3-ForcedAligner-0.6B`，Luna 已交付 [本地 worker](tools/local-aligner/align.py)。新设备 CPU FP32 离线真人录音推理通过；已知原生零时长录音被明确拒绝并保留全部诊断。GPU 推理、旧录音/Gemini 对照及声学边界听审仍未验收，见 [本机验收记录](docs/reviews/M02-local-forced-aligner-new-device.md)。
- 分离、按停顿分句、句内字头和细致语气分析已有 CLI。第03段真人素材的新流程已生成可校验结果；原生重合字头保留，模型候选和未知不冒充实测。见 [真人流程记录](docs/reviews/M02-seven-case03-flow.md)。
- 原创 Mutsumi 人格、纯文本/处理后音频 JSON 到真实 Gemini 正文、近期历史跨服务重启、明确记忆写入/确认/修正/删除及新会话带记忆回复均已验证。客户端输出正文与来源、工具状态、记忆动作分开，Jev/TTS 未接入。见 [聊天核心验收](docs/reviews/M03-astrbot-chat-core.md)。
- 本地知识库真实检索和固定 Yahoo 免费搜索已验证。Gemini 完整工具循环仍返回上游 HTTP503；绕过项目代码的最小标准 function-calling 请求也失败，不能称工具聊天已通过。YouTube 字幕样例不可用，视频画面/音轨理解 unavailable。
- Qwen3-TTS 1.7B CustomVoice 历史预设音色 CPU 试部署已生成中文音频；用户要求自定义音色，当前方案不作为最终选型，Qwen3-TTS 与 IndexTTS 比较另行完成。
- TypeScript 构建和 287 项现有测试通过；本机直接运行对应的 build/test 命令验证。结构测试通过不等于识别、切片和情绪质量通过。

换设备请先读 [交接说明](docs/device-handoff.md)，然后读 [已确认决策](docs/decisions.md)。历史任务和评审记录中的旧方案不覆盖最新决策。

## 本地准备与检查

需要 Node.js24 或更新版本、npm；处理音频还需要 FFmpeg/FFprobe。进入项目根目录：

```sh
npm ci --ignore-scripts
npm run check
```

将 `.env.example` 复制为 `.env`，在新设备自行配置对应服务的密钥和路径。检查命令不调用云端，不需要 API Key。

已有 HTTP 原型可以通过 `npm start` 启动，开发演示通过 `npm run start:mock` 启动。开发模式只演示结构，不证明真实供应商或 TTS 已接通；它们不是待实现的分离式 CLI 输入流程。

## 本地强制对齐 worker

独立环境和固定版本官方权重的恢复见交接说明。CPU 路线不需要 API Key；输入须为真人录制的单声道16kHz WAV（最长120秒）和 UTF-8 原文文件。JSON 原文使用 `{"transcript":"原文"}`；普通文本文件保留完整原文。将示例路径替换为实际录音/文字路径：

```powershell
.runtime/aligner-venv/Scripts/python.exe tools/local-aligner/align.py --audio data/input.wav --text-file data/transcript.json --device cpu --language Chinese
```

相对路径均从项目根解析。stdout 只有一个 JSON；成功 exit0，失败 exit1。字词区间为模型原生预测，零/无效区间或文字覆盖不符会返回 invalid_alignment，并保留全部原生诊断，不补时、不拆分、不回退。这个 worker 尚未接入 Node TimingPort 和分离式输入 CLI。

## 编码与数据

后续应用代码由 ChatGPT 认证的 Codex CLI `gpt-6-luna` 编写；监督 Codex 负责架构、任务边界、逐文件提交和独立验收。历史 Qwen/DeepSeek 编码入口保留，已不再是新任务的默认选择。编码模型与运行时语音模型分别选择。

```sh
codex login
node tools/harness/run-luna.mjs --check
# 仅对已批准任务执行：
node tools/harness/run-luna.mjs docs/tasks/TASK.md --effort=medium --timeout-ms=600000
```

每次实现只修改一个指定文件，由监督者立即单独提交后继续。用户已授权本轮完成后同步 GitHub（D47）；当前工具循环验收失败，同步范围待确认，以验收记录和实际远端状态为准。`.env`、私人录音/会话与原始响应 `data/`、编码记录/虚拟环境 `.runtime/`、依赖与构建产物均不提交。

架构见 [docs/architecture.md](docs/architecture.md)，接口见 [docs/contracts.md](docs/contracts.md)，流程见 [voice-system-flow.md](voice-system-flow.md)。


## 本地 TTS 试听部署

当前采用官方 Qwen3-TTS-12Hz-1.7B-CustomVoice、Serena 中文预设女声，CPU FP32 离线生成完整 WAV。验收和恢复依赖见 [本机 TTS 记录](docs/reviews/M04-local-tts.md)；应用代码由 gpt-6-luna CLI 编写。36 项结构/异常检查与真实合成通过，发音完整性、音色和情绪仍待真人试听。生成音频属于 TTS 输出，不作为真人输入录音验收。

请求文件是 UTF-8 JSON，例如 {"text":"你好，我在这里。","speaker":"Serena","instruct":"温柔平静地说话"}。文本最多200字，指令最多240字，当前固定中文。下方本机已有请求文件可重用，输出目录每次选新的或空的；worker 不覆盖旧输出：

```powershell
.runtime/tts-venv/Scripts/python.exe tools/local-tts/synthesize.py --request-file data/acceptance/local-tts/gentle-request.json --output-dir data/acceptance/local-tts/my-tts-run --threads 6 --max-new-tokens 256
```

输出 output.wav 与 synthesis.json；时长由真实帧数计算，逐字时间 unavailable，情绪指令效果和是否读全 not_verified，不进行补时或声称精确语速/停顿/强度。现有约4..6秒试听音频耗时42..58秒生成，CPU 路线尚不适合流畅对话。GPU 加速及 Gemini → Jev → TTS 接线另行实现；当前磁盘余量不足以再安装完整 CUDA 依赖。

## 本地自动分句（2026-10-03）

[通用分句程序](tools/local-aligner/sentences.py) 接收已分离的单声道16kHz人声和完整转写，自动全段推理、按已有句末标点或较长人声间隙提出句子，并自动对可修复的无效句界作局部推理。原文不变，输出句子候选时间、实际采样裁剪WAV和全部诊断。参考答案仅在程序运行后由监督者比较，程序不接受参考句子、目标数量或缓存对齐输入。

本机已有隔离CPU环境、固定本地Qwen3-ForcedAligner权重，不需API Key。例如对独立验收中的第二段素材重新生成结果（输出目录须新建或为空）：

```powershell
.runtime/aligner-venv/Scripts/python.exe tools/local-aligner/sentences.py --audio data/acceptance/automatic-sentences-001/inputs/audio-2.wav --text-file data/acceptance/automatic-sentences-001/inputs/text-2.json --output-dir data/acceptance/my-sentences-001 --threads 6 --pause-threshold-ms 600 --crop-margin-ms 150
```

默认停顿阈值600ms可调100..3000ms；默认局部推理窗余量150ms不是句界时间。JSON文本只接受精确的 {"transcript":"原文"} 对象，也可用纯UTF8文本。已有输出不覆盖；ok表示所有句界为模型候选，partial保留不可定位句及诊断，不伪造时间。当前自主重跑fumo得到7句、衣柜得到3句且运行后才与用户标准比较一致；23项独立结构检查和真实离线推理通过，详见[验收](docs/reviews/M02-automatic-sentence-worker.md)。该独立worker尚未连接完整原音分析/ASR生产入口，逐字起点和输入情绪仍待接入。

## 每句字／词起点与输入情绪（2026-10-03，D42）

在自动分句输出之后运行 [character_starts.py](tools/local-aligner/character_starts.py)，对每句实际采样片段重新推理。只定位模型原生起点；相邻不同起点形成占用区间，末块到句尾，包含停顿。重合起点合并并标明不确定，整词不强行拆字，原始诊断保留。例如：

```powershell
.runtime/aligner-venv/Scripts/python.exe tools/local-aligner/character_starts.py --audio data/acceptance/automatic-sentences-001/inputs/audio-2.wav --sentences-file data/acceptance/automatic-sentences-001/output-2/sentences.json --output-dir data/acceptance/my-character-starts-001 --threads 6
```

输出目录须新建或为空，character-starts.json 不覆盖旧结果。相对路径从项目根解析，模型固定本地离线CPU；status partial 保留起点重合/整词/失败，不能当逐字精度全部通过。

随后 [OhMyGptEmotion](apps/server/src/providers/ohmygpt/ohmygpt-emotion.ts) 用真实人声音频和不可修改的句子投影分析情绪，固定已有 OhMyGPT Gemini 路线，每段一次请求，返回按句候选含unknown，不修改文字/时间、不编造评分。当前只接受完整可用句界且省略units的EmotionInput；占用区间不冒充旧发音首尾。模块此前已真实调用通过；人声 CLI 见下文，新 CLI 的云端端到端验收仍待具体目的地确认。

[本轮验收](docs/reviews/M02-character-starts-emotion.md)：字头24项独立检查、情绪36项、完整构建与287项回归通过；两段真人10句得到154原生单位/149占用区间，两次情绪HTTP200得到10候选。字头精度、原话和情绪仍待真人核对。私有试听页 http://127.0.0.1:8770/（服务运行时），每句播放和字块试听；原分句8769、原音分离对照8768保留。应用代码仍仅ChatGPT认证gpt-6-luna CLI编写，逐文件本地提交，无push。

## 人声分析统一 CLI（2026-10-04）

[analyze-vocals.mjs](tools/analyze-vocals.mjs) 已接通：已分离的单声道16kHz WAV + 完整原文 → 自动分句 → 每句内部字／词起点与占用块 → 可选逐句情绪。默认全本地，不读取 .env；不会输入参考句子或读取缓存对齐。它还不包含原音整体分析、人声分离、ASR、人格／记忆或 TTS 的统一入口。

在项目根目录运行；本机 bundled Node24.19.0 的路径如下，迁移时替换为新设备 Node 路径。输出目录每次使用新的 data/ 或 .runtime/ 子目录，已有目录不覆盖：

```powershell
& 'C:/Users/anpel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' tools/analyze-vocals.mjs --audio data/acceptance/automatic-sentences-001/inputs/audio-2.wav --text-file data/acceptance/automatic-sentences-001/inputs/text-2.json --output-dir data/acceptance/my-vocals-cli-001
```

实际输出：inputs/ 原始快照、sentences/sentences.json 和裁剪 WAV、character-starts/character-starts.json、result.json；中途失败保留已完成结果和 failure.json。partial 明确保留起点重合／整词／失败；相邻起点时长含停顿，不等同于精确发音时长。纯本地 partial 可 exit0，请仍检查逐阶段状态。

--emotion 会在字头结果保存后使用已配置的 OHMYGPT_API_KEY、可选 OHMYGPT_PROXY_URL，发送真实人声快照与不可修改的句子投影到 https://api.ohmygpt.com/v1/chat/completions，固定 gemini-3.8-flash，一段一次请求，无自动重试。仅支持≤30秒且所有句界可用；要求情绪但不可用／失败时 exit1。密钥不放命令行，子进程代理只作用于该 Node 请求，Python 子进程不继承凭据或代理。本轮该云端验收被自动审批拦截，已请求用户对具体目的地确认，尚未执行；此前适配器成功调用不冒充本次成功。

[验收记录](docs/reviews/M02-vocals-cli.md)：34项结构＋7项子进程检查通过；一次新衣柜真人本地 CLI 推理99.3秒，自主3句、40原生单位／39正占用块，实际裁剪帧数匹配。字头精度仍待真人听审。[8770试听页](http://127.0.0.1:8770/) 的衣柜部分展示本次新结果，情绪标为本次未请求。应用源码通过 ChatGPT 认证的 gpt-6-luna CLI 写入，逐文件立即本地提交，无push。
## 细致输入情绪与语气（2026-10-04）

按句分别观察语气（如解释、疑问、强调、犹豫）、声音表现（语速、能量、音高变化、升降调、声音质感）、情绪候选与愉悦／唤醒倾向，每项判断附声音依据和不确定因素。neutral 不再是唯一描述；缺少依据时明确 unknown。工程设计参考情绪环状模型、韵律／声音质感研究及 openSMILE、emotion2vec，见 [设计依据](docs/input-vocal-affect-design.md)。这些是模型听感候选，不是心理诊断或实测 Hz/dB。

统一人声 CLI 的 --emotion 使用同一 Gemini 音频请求返回并严格校验 vocal_affect，保存于 emotion/emotion.json；分句、原文及字头时间不变。8770 私有试听页已有细致展示区，旧结果不补造描述，真实新分析尚待具体云端目的地确认。结构通过不等于真人语气质量通过。
2026-10-05 已用七段压缩包第03段完成真实分阶段测试：原音整体分析、人声分离与转写、自动4停顿片段、24原生字单位／23占用块、4句细致语气候选。最初情绪请求失败，Luna修复远端生成schema兼容性及依据提示后，新CLI exit0/partial、emotion complete；重合字头仍保留partial，没有补时间。完整验收及局限见 [第03段记录](docs/reviews/M02-seven-case03-flow.md)。[8770试听页](http://127.0.0.1:8770/) 顶部可对照三轨、字块和新语气依据。听感、转写和情绪候选仍待真人核对，当前生产CLI依然从已分离音频与文字开始。
## 人格聊天入口

先按 [交接说明](docs/device-handoff.md) 恢复独立 Mem0 和 AstrBot 服务。客户端不自动读取 `.env`；启动它的进程需设置 `MUTSUMI_CHAT_BASE_URL` 和私有 `MUTSUMI_CHAT_API_KEY`，避免把密钥写入命令行或提交仓库。输入契约为 `mutsumi-chat-input-1`，具体字段和示例见 [聊天设计](docs/chat-core-integration-design.md) 与任务 [客户端](docs/tasks/M03-astrbot-chat-client.md)。

```sh
node tools/chat-core/chat.mjs --input-file data/chat-input.json --output-dir data/chat-run-001
```

输出目录必须尚不存在，由客户端创建；已有目录会被拒绝。正文 `reply_text` 供后续 TTS；`references`、`tool_trace`、`memory_actions` 是独立旁路数据，不朗读原始工具结果或推理。合成 SSE 检查通过仅证明客户端格式处理；实际 LLM 工具调用未通过。框架新会话可能另调相同模型生成标题，单次请求不重试不等于每个聊天 HTTP 请求只调用模型一次。
