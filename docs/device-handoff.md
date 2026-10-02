# 换设备交接（2026-10-02）

## 接续位置

原设备交接时，所有者要求同步至 https://github.com/pellx/mutsumi 以换设备。新设备接续后，所有者确认 D29：当前只写入和提交本地仓库，迁移设备时再同步，不因模块通过就自动推送。本文件区分原设备历史阻塞与新设备实际验收。

最新已批准方案是 D28：Gemini 保留转写/背景描述，Qwen3-ForcedAligner 在本地接收同一段音频和指定文字，只负责原生字词时间；后续 Gemini 情绪阶段独立。背景描述不能充当强制对齐文字。不得均分时间、把不同 ASR 文字按序贴到参考文字上，或静默重试/改回 Paraformer。

[M02-local-forced-aligner-worker.md](tasks/M02-local-forced-aligner-worker.md) 已由 ChatGPT 认证的 Luna CLI 实现：[tools/local-aligner/align.py](../tools/local-aligner/align.py)。新设备 CPU FP32 离线真人录音推理与 worker 成功/失败结构通过监督验收；原生零时长会明确拒绝并保留全部诊断。旧录音/Gemini 对照、声学边界听审、日常对话/噪声条件和 GPU 推理仍未验收。下一步是设计 Node TimingPort 子进程适配器，再接完整输入 CLI；情绪适配器待实现。详见 [新设备验收记录](reviews/M02-local-forced-aligner-new-device.md)。

## 新设备已验环境（2026-10-02）

当前项目根为 `E:\mutsumi\mutsumi`，运行路径从项目根解析。Windows10，Xeon E5-2673 v3（12核/24线程），约32GB内存，RTX2060 6GB。本机已有系统管理的2GB页面文件，模型 CPU FP32 加载与真人推理未复现1455；未修改驱动/页面文件。当前只验收 CPU，不假定旧设备 AMD 环境存在或本机 CUDA 已成功。

- 忽略的 `.runtime/aligner-venv`：Python3.12.14、qwen-asr0.0.6、torch2.10.0+cpu、transformers4.57.6；pip check通过。详细固定依赖清单保留在 `.runtime/qa/aligner-freeze.txt`。
- 官方模型仍固定 revision `c7cbfc2048c462b0d63a45797104fc9db3ad62b7`；模型字节数1,835,544,544，SHA256 `47831d0e82f96b20e9034dba01a075ee06436654719f6a68289e49f1b65ce0e7` 已验证。
- LibriSpeech 真人朗读：一条录音返回10个有效原生字词区间；另一条出现 THE 2.32→2.32秒，worker返回invalid_alignment并保留全部17单元。官方中英文样本用于补充 SDK检查。没有补时、删除无效单元或用合成语音冒充验收。
- 原仓库关闭ACL继承导致 Luna 沙箱拒绝写入。所有者批准修复，但 UAC 未完成；实际权限未改变。监督者在批准工作区内使用隔离 Git 工作树，Luna保持原workspace-write沙箱实现并逐文件提交，再将提交取回原本地主分支。临时工作树完成后清理，报告另存忽略目录；不使用无限制编码执行。
- 所有者后续自行解决 Codex/VPN 代理问题，监督者没有修改代理/路由设置。恢复工作不应覆盖所有者当前配置。

## 原设备环境与真实阻塞（历史）

原设备 Windows，Ryzen5 7600，约32GB内存，AMD RX6950XT和集成 Radeon。项目本地环境如下，均被忽略且不会随 Git 下载：

| 路径 | 实际安装 |
| --- | --- |
| `.runtime/aligner-venv` | Python3.12.10、qwen-asr0.0.6、torch2.10.0+cpu、transformers4.57.6 |
| `.runtime/aligner-directml-venv` | Python3.12.10、qwen-asr0.0.6、torch2.4.1、torch-directml0.2.5.dev240914、numpy1.26.4、transformers4.57.6 |
| `data/models/Qwen3-ForcedAligner-0.6B` | 官方 Hugging Face 权重，固定 revision `c7cbfc2048c462b0d63a45797104fc9db3ad62b7` |

DirectML 能枚举设备1为 RX6950XT、设备0为集成显卡。不能默认选择设备0。当前官方 Windows ROCm/PyTorch支持矩阵未列 RX6950XT，不安装/修改显卡驱动，也不把 GPU 枚举作为推理验收。

真实录音 CPU/DirectML 尝试均在加载模型时失败，错误 `os error1455`（页面文件太小）；CPU 串行及 FP16 尝试亦失败。系统页面文件查询为空，提交内存接近上限；游戏进程约占10GB提交内存。没有关闭所有者程序或更改系统设置。换设备先确保有足够提交内存，再运行单份模型。不能宣称 AMD GPU 已成功推理，也不能声称 CPU 音频对齐已通过。

名称0.6B大致对应语言骨干规模，实际下载权重头部统计共917,728,896参数（语言骨干596,180,992，音频塔316,427,904，输出头5,120,000）；BF16 safetensors文件1,835,544,544字节。加载时还需要运行库、精度转换及音频中间张量空间。

## 新设备恢复

```sh
git clone https://github.com/pellx/mutsumi.git
cd mutsumi
npm ci --ignore-scripts
npm run check
```

准备 Node24+，FFmpeg/FFprobe 需在 PATH 或新设备 `.env` 中分别配置对应路径。当前构建与287项测试已通过，不调用付费接口。

自行复制 `.env.example` 为 `.env` 并配置需要的密钥。本地对齐无需 API Key。已有云端凭据不得发送给编码模型或提交 Git；不同供应商的 Key 不混用。已有服务器/浏览器原型不是分離输入 CLI，`npm start` 不能证明本地 ForcedAligner 已接入。

若使用 uv，可按原方案重建两个隔离环境，不能把 DirectML 和新 CPU Torch 安装到同一环境：

```sh
uv venv --python 3.12 .runtime/aligner-venv
uv pip install --python .runtime/aligner-venv/Scripts/python.exe "qwen-asr==0.0.6" "torch==2.10.0" --index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match --link-mode=copy

uv venv --python 3.12 .runtime/aligner-directml-venv
uv pip install --python .runtime/aligner-directml-venv/Scripts/python.exe "qwen-asr==0.0.6" "torch-directml==0.2.5.dev240914" "numpy<2" --index-url https://pypi.org/simple --link-mode=copy
```

这些是 Windows 环境重建命令，尚不保证另一设备模型可运行。worker 已部署并验收本机 CPU 路线；新设备仍须恢复独立环境/权重并重新进行真人推理。其他操作系统先重新核对后端支持，不能硬套 Windows DirectML，也不要在没有 RX6950XT 的设备选择此 worker 的 DirectML 选项。

公开权重需在新设备重新下载（约1.84GB），Python中使用 `huggingface_hub.snapshot_download`，指定官方 repo `Qwen/Qwen3-ForcedAligner-0.6B`、上述 revision、`local_dir='data/models/Qwen3-ForcedAligner-0.6B'`、`token=False`，下载 json/txt/safetensors 文件。模型推理使用本地文件、不信任远程代码；录音不需要上传模型仓库。

登录 ChatGPT 认证 Codex CLI，使用 `gpt-6-luna` 的既有 launcher。新设备无需原机 `VOICEBOT_CODEX_BIN` 绝对路径；Codex 在 PATH 即可。任务每次只写一个指定文件，监督者核对 diff 并立即单独提交后继续下一文件；不得批量改文件再提交。

## Git 之外的数据

GitHub仅传输源码、测试、配置模板、文档与提交历史，不传输 `.env`、`data/`、`.runtime/`、模型、依赖或构建产物。若还要复用所有者录音、真实结果和监督 QA 脚本，应自行通过可信私有渠道复制 `data/` 和需要的 `.runtime/qa/`；不要复制整个虚拟环境到另一设备，不要 force-add 忽略文件。也可以新设备提供自己的真人录音，重新按原流程验收。

当前实时轮次/VAD/打断/音频流均不在范围；对话/TTS云模型未选择。原有 mock 只验结构。先确保本地对齐实际运行，保留原生零/无效时间诊断并明确拒绝，不能用合成音频验收或把成功返回JSON当成切片准确。

来源：[官方模型](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)、[Qwen3-ASR代码](https://github.com/QwenLM/Qwen3-ASR)、[AMD Windows矩阵](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/windows/windows_compatibility.html)、[DirectML](https://learn.microsoft.com/en-us/windows/ai/directml/pytorch-windows)。
