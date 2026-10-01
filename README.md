# mutsumi

情绪语音助手原型，计划采用手动录音 → 转写与声音标注 → 人格和记忆参与对话 → 表达规划 → TTS → 播放完整回复。技术栈为 TypeScript、NestJS 和浏览器 UI。

## 当前已实现

- 与框架和供应商无关的语音标注数据类型、校验、JSON 解析及序列化。
- 显式记录时间是否可用、字词起止时间、片段情绪、来源和分数含义；不伪造缺失数据。
- 104 个合成数据验收测试及严格类型检查。
- 通过 Codex CLI 调用百炼 Qwen3.8-Flash 的受限编码 harness。

目前没有可启动的 NestJS 服务、录音界面或完整语音对话流程。真实音频效果尚未验收。已选下一阶段使用 qwen3-asr-flash-filetrans 异步转写、开启文字时间戳和句级情绪，先用百炼临时上传，后续替换成自己的 OSS。

## 本地检查

需要 Node.js 24 或更新版本及 npm。

```sh
npm ci --ignore-scripts
npm run check
```

检查不需要云端密钥，不调用付费服务。数据模块位于 `apps/server/src/domain/annotation.ts`，验收测试位于 `tests/acceptance/annotation.test.mjs`。

## 编码委派

业务代码由 Qwen 编写，Codex 负责接口、任务范围、审查和独立验收。历史 DeepSeek 工具保留供追溯，已停止使用。

将 `.env.example` 的配置复制到本地 `.env`，填入 `DASHSCOPE_API_KEY`。需要安装 Codex CLI。以下 readiness 检查不证明联网成功：

```sh
npm run harness:check
node tools/harness/run-qwen.mjs docs/tasks/TASK.md --effort=medium --timeout-ms=600000
```

最后一条会调用付费编码模型，只运行已经释放的任务。每次委派只修改一个指定文件，监督者立即单独提交再验收。`.env`、私有录音 `data/`、编码报告 `.runtime/` 和依赖目录均忽略，不提交。

架构见 `docs/architecture.md`，已确认决策见 `docs/decisions.md`，接口见 `docs/contracts.md`，流程图见 `voice-system-flow.md`。规划中的模块不是已实现的能力。
