# mutsumi

情绪语音助手原型。当前优先完成 CLI 输入分析：音频 → Gemini 提取文字与背景声音 → 本地强制对齐 → Gemini 判断情绪。之后再接人格、记忆、对话和 TTS。已有 NestJS 服务和浏览器原型保留，前端后续再完善。

## 当前状态（2026-10-02）

- 已有供应商无关的标注契约、严格校验、原始音频存储、FFmpeg 接入、会话存储与上下文/表达计划基础模块。
- 已有阿里云上传/ASR、OhMyGPT 音频分析，以及分离后的 Gemini 转写与 Qwen-Audio 时间适配器。Qwen-Audio 仍会改写文字，真实录音对照被拒绝，不能当作准确的强制对齐。
- 已选本地 `Qwen3-ForcedAligner-0.6B`，Luna 已交付 [本地 worker](tools/local-aligner/align.py)。新设备 CPU FP32 离线真人录音推理通过；已知原生零时长录音被明确拒绝并保留全部诊断。GPU 推理、旧录音/Gemini 对照及声学边界听审仍未验收，见 [本机验收记录](docs/reviews/M02-local-forced-aligner-new-device.md)。
- 独立情绪阶段、分离流程的 CLI 入口仍待实现。回复文本已选 Gemini、表达已选 Jev，真实适配与完整流程尚待接入。新增本地 Qwen3-TTS 1.7B CustomVoice CPU 离线试部署和独立 worker，实际中文音频已生成；音质/情绪待试听，CPU 耗时较长，尚未接入完整回复链路。现有开发 mock 不能代表完整真实语音能力。
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

每次实现只修改一个指定文件，由监督者立即单独提交后继续。当前只提交本地仓库，迁移设备时再同步 GitHub（D29）。`.env`、私人录音/会话与原始响应 `data/`、编码记录/虚拟环境 `.runtime/`、依赖与构建产物均不提交。

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

随后 [OhMyGptEmotion](apps/server/src/providers/ohmygpt/ohmygpt-emotion.ts) 用真实人声音频和不可修改的句子投影分析情绪，固定已有 OhMyGPT Gemini 路线，每段一次请求，返回按句候选含unknown，不修改文字/时间、不编造评分。当前只接受完整可用句界且省略units的EmotionInput；占用区间不冒充旧发音首尾。模块已真实调用通过，完整生产CLI接线尚未完成。

[本轮验收](docs/reviews/M02-character-starts-emotion.md)：字头24项独立检查、情绪36项、完整构建与287项回归通过；两段真人10句得到154原生单位/149占用区间，两次情绪HTTP200得到10候选。字头精度、原话和情绪仍待真人核对。私有试听页 http://127.0.0.1:8770/（服务运行时），每句播放和字块试听；原分句8769、原音分离对照8768保留。应用代码仍仅ChatGPT认证gpt-6-luna CLI编写，逐文件本地提交，无push。
