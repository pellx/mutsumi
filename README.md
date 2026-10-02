# mutsumi

情绪语音助手原型。当前优先完成 CLI 输入分析：音频 → Gemini 提取文字与背景声音 → 本地强制对齐 → Gemini 判断情绪。之后再接人格、记忆、对话和 TTS。已有 NestJS 服务和浏览器原型保留，前端后续再完善。

## 当前状态（2026-10-02）

- 已有供应商无关的标注契约、严格校验、原始音频存储、FFmpeg 接入、会话存储与上下文/表达计划基础模块。
- 已有阿里云上传/ASR、OhMyGPT 音频分析，以及分离后的 Gemini 转写与 Qwen-Audio 时间适配器。Qwen-Audio 仍会改写文字，真实录音对照被拒绝，不能当作准确的强制对齐。
- 已选本地 `Qwen3-ForcedAligner-0.6B`，Luna 已交付 [本地 worker](tools/local-aligner/align.py)。新设备 CPU FP32 离线真人录音推理通过；已知原生零时长录音被明确拒绝并保留全部诊断。GPU 推理、旧录音/Gemini 对照及声学边界听审仍未验收，见 [本机验收记录](docs/reviews/M02-local-forced-aligner-new-device.md)。
- 独立情绪阶段、分离流程的 CLI 入口仍待实现。对话/TTS 云模型尚未选定；现有开发 mock 不能代表完整真实语音能力。
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
