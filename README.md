# mutsumi

情绪语音助手原型，计划采用手动录音 → 转写与声音标注 → 人格和记忆参与对话 → 表达规划 → TTS → 播放完整回复。技术栈为 TypeScript、NestJS 和浏览器 UI。

## 当前已实现

- 与框架和供应商无关的语音标注数据类型、校验、JSON 解析及序列化。
- 显式记录时间是否可用、字词起止时间、片段情绪、来源和分数含义；不伪造缺失数据。
- 转写与发布接口、阿里云结果映射、临时上传、异步任务提交/轮询/结果下载适配器。
- Qwen 文字时间缺失或零时长时，条件调用一次 Paraformer 校准；保持原始文字和句级情绪，标明时间来源，不拆分或平均供应商单位。
- 合成数据验收测试及严格类型检查，覆盖时间边界、取消、超时、响应大小和错误信息隔离。
- 通过 Codex CLI 调用 Qwen3.8-Flash 的受限编码 harness；Qwen 失败时使用用户授权的官方 DeepSeek 后备。

目前交付到语音标注适配器，没有可启动的 NestJS 服务、录音界面或完整语音对话流程。已选 qwen3-asr-flash-filetrans 异步转写、文字时间戳和句级情绪，先用百炼临时上传，后续替换成自己的 OSS。条件校准已经用 6.268 秒的本地合成中文样本完成真实验证：Qwen、Paraformer 各提交一次，原始两个零时长字修复为 190ms 和 240ms，最终 19 个单位均有正时长；文字、情绪标签和原始情绪时间保持一致。默认检查的 230 项测试通过。此轮本地修复等待所有者体验验收，尚未推送本模块；真实人声的情绪识别质量仍需单独验收。详情见 `docs/reviews/M02-conditional-calibration-acceptance.md`。

## 本地检查

需要 Node.js 24 或更新版本及 npm。

```sh
npm ci --ignore-scripts
npm run check
```

检查不需要云端密钥，不调用付费服务。数据模块位于 `apps/server/src/domain/annotation.ts`，验收测试位于 `tests/acceptance/annotation.test.mjs`。

## 编码委派

业务代码优先由 Qwen 编写，连接失败时按用户授权调用官方 DeepSeek。Codex 负责接口、任务范围、审查和独立验收。编码模型和运行时 ASR、对话、TTS 模型分别选择。

将 `.env.example` 的配置复制到本地 `.env`，填入 `DASHSCOPE_API_KEY`。需要安装 Codex CLI。以下 readiness 检查不证明联网成功：

```sh
npm run harness:check
node tools/harness/run-qwen.mjs docs/tasks/TASK.md --effort=medium --timeout-ms=600000
# Qwen 失败时，使用独立的 DEEPSEEK_API_KEY 和已释放任务：
node tools/harness/run-deepseek.mjs docs/tasks/TASK.md
```

最后一条会调用付费编码模型，只运行已经释放的任务。每次委派只修改一个指定文件，监督者立即单独提交再验收。`.env`、私有录音 `data/`、编码报告 `.runtime/` 和依赖目录均忽略，不提交。

架构见 `docs/architecture.md`，已确认决策见 `docs/decisions.md`，接口见 `docs/contracts.md`，流程图见 `voice-system-flow.md`。规划中的模块不是已实现的能力。
