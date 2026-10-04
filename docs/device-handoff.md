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

## 回复分阶段进展（2026-10-02，D30）

用户明确要求：已处理语音 + 自定义人格/上下文 -> Gemini 生成回复文本 -> JEV 决定回复表达情绪。JEV 不能改写 Gemini 文本；输入说话人的情绪仍是独立分析，不是回复情绪。新的 [separated-reply.ts](../apps/server/src/application/separated-reply.ts) 由 ChatGPT 认证的 gpt-6-luna CLI 完成，监督者逐文件立即提交并合回 main。28 项新结构验收、TypeScript 构建及 287 项现有回归通过；[验收记录](reviews/M03-separated-reply.md) 说明范围和证据。文本和表达分别保留来源；JEV 缺失/失败保留文本，取消和共享截止时间均有结构检查。

尚未接真实 Gemini/JEV、CLI 或旧 RoundService。已询问但尚未确认：回复 Gemini 是否沿用 OhMyGPT gemini-3.8-flash，以及 JEV 的准确项目/模型/API。不要自动选择替代模型、用 Gemini 输出充当 JEV 情绪、把结构 mock 当真人录音验收或声称 TTS 完成。本轮没有新外传音频或付费调用。此前强制对齐结果保留供用户后续听审。全部提交仅本地，迁移时再同步 GitHub。

### 模型确认与 Jev 映射（D31，2026-10-02）

上一节的模型识别问题已解决：用户确认回复 Gemini 沿用 OhMyGPT gemini-3.8-flash；所述热门 JEV 已依据官方资料识别为 TypeSafe AI Jev，验收固定当前稳定 jev-1.13.0。官方请求 POST https://api.typesafe.ai/v1/systemone，独立 TYPESAFE_API_KEY；本地目前未配置该键，不得借用 relay/coding 密钥。

Luna 已实现 [jev-reply-result.ts](../apps/server/src/providers/typesafe/jev-reply-result.ts)：独立 Choice 情绪类别与 Score 表达强度问题，严格校验原生概率/评分并保留置信信息，初版一条完整回复一个表达段，unknown 不编造默认情绪。29 项监督结构检查、构建和 287 项既有回归通过；[详细验收](reviews/M03-jev-reply-result.md)。仅映射层已验收；Gemini 文本/Jev HTTP 适配器、私有决策证据持久化、完整 CLI 和真人录音衍生回复质量验收仍待实现。无真实 Jev 调用、新数据外传或付费调用。本地逐文件提交，无 push。

### 最新本机进展：人声分离、字起点与人格卡（2026-10-02）

实际项目根 E:/mutsumi/mutsumi。本机硬件已重新核查，CPU链路可运行；不要沿用旧设备AMD/DirectML假设。用户手动解决代理，不再改代理/系统页面文件；仅本地逐文件提交，迁移设备时再同步，不 push。

D32双TYPESAFE_API_KEY/TYPESAFE_API_KEY_2已由用户填写，均通过只读官方models鉴权检查；不代表额度或真实Jev推理已验收。JevHTTP/额度切换草稿尚未验收，保存在 E:/mutsumi/jev-quota-worker 独立提交中；不要删除或将语法坏草稿直接合入main。旧TypeScript解析器路径假设已纠正；未来用Node24的node:module.stripTypeScriptTypes作内存语法检查。Gemini继续已选OhMyGPT gemini-3.8-flash；Jev继续官方jev-1.13.0，各司文本/表达，不能替代。

D33确认原音->分离人声->转写->句子范围->字起点；逐字不要求结束时间，重复起点仍歧义，不挪动插值。完整区间旧契约不放宽。详见 [设计](input-vocals-onsets-design.md)。tools/local-aligner/onset_result.py 已独立26项检查通过，但只是起点结果映射器，尚未接句子定位或融合CLI。

本机隔离.runtime/separator-venv部署Demucs4.1.0/Torch2.10.0+cpu。默认 data/models/HTDemucs 是固定官方safetensors修订与哈希；真人“序列”录音本地分离已跑通，tools/vocal-separator/separate.py 已20项结构/异常测试和实际离线ownerworker验收通过；音质仍待听审。SF MP3头部帧数是估计值，真实解码229248frames/44100Hz=5.198367347s，16k分析83174frames=5.198375s；不要按头部246515frames去补齐或建立时间轴。[验收记录](reviews/M02-vocals-onset-pilot.md)。私有音轨/两次转写/raw结果在ignored data/acceptance/owner-sequence，QA在ignored .runtime/qa，部署虚拟环境不可跨设备整目录照搬。

用户明确说“待会再核对，你先做别的模块”。不要重复催音频原话确认，不编造human-reference，不声称转写/句子/音素/输入情绪质量已通过。浏览器仅私有试听对照：127.0.0.1:8767（若仍运行）；原混音、vocals、accompaniment均可播放，两个未确认转写分别保留。人声不是去混响保证，情绪应独立检查分离是否改变语气。

社区人格/记忆调研见 [草案](persona-memory-community-design.md)。Luna已实现 apps/server/src/domain/persona-card.ts，支持身份、性格/说话方式、规则、场景/关系设定、虚构风格示例及有authority标签的编排，保留旧Persona8条x1000字预算。28项独立检查、TypeScript构建、287项既有回归通过；[人格卡验收](reviews/M03-persona-card.md)。仅卡格式/编译器已验收，无默认人格激活、第三方卡下载、真实Gemini回复接入或长期记忆。Node24.19.0内置SQLite3.53.3已实测create/insert/select，但持久记忆尚未实现。

下一步优先继续Gemini TextReplyPort/人格卡本地加载及MemoryPort持久化与相关性检索，再修复独立JevHTTP传输并接完整回复CLI；音频句子定位/裁剪/起点/输入情绪留待用户恢复听审分别验收。不要把短6轮history当长期记忆。每个应用文件继续由ChatGPT认证gpt-6-luna CLI写入，每次成功物理写立即单文件提交，监督者独立验收。所有新模块的Luna运行日志已保留在 .runtime/harness-runs 各worktree目录中。没有GitHub发布。


### Latest: local expressive TTS trial (D34,2026-10-02)

Owner requested trying an advanced local TTS while audio transcription/listening remains postponed. Actual repo E:/mutsumi/mutsumi. New module [tools/local-tts/synthesize.py](../tools/local-tts/synthesize.py) authored by ChatGPT-authenticated gpt-6-luna CLI, one-file immediate local commits; accepted offline preset artifact synthesis after supervisor review. Main source commits81ce9d1/146dc25/c38384d. [Trial record](reviews/M04-local-tts.md) contains exact device, model hashes, environment, commands, tests and limitations. No push.

Rechecked RTX2060 6144MiB/driver591.44 (free GPU memory fluctuates), XeonE5-2673v3 12/24, RAM33390216KiB, existing pagefile2048MB. E-disk started about5.5GB, only about0.8GB bytes left after model; C about1.1GB free. No global driver/proxy/pagefile or prior environment changes, no unrelated deletions. Do not attempt another full CUDA Torch installation under this disk budget. GPU inference still unaccepted; CPU does not prove GPU support or realtime latency.

Official Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice revision0c0e3051f131929182e2c023b9537f8b1c68adfe stored ignored data/models/Qwen3-TTS-12Hz-1.7B-CustomVoice, about4.52GB including tokenizer. HF LFS SHA256 verified model38b1d5971bdbd982b561cccec982669a53b0537c3cf5e9bd4778ed07bb2f5137, codec836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258. Do not redownload duplicate weights/caches. Runtime .runtime/tts-venv qwen-tts0.1.1/transformers4.57.3/onnxruntime1.24.4; readonly .pth references aligner/separator site-packages for CPU Torch2.10.0+cpu/torchaudio2.10.0+cpu/accelerate1.12.0 etc. Recreate these environments and absolute .pth entries on migration, not portable-venv copy. Full runtime/model manifests .runtime/tts-bootstrap/*.json.

Current worker is CPU FP32/eager only, fixed Chinese, nine preset speaker names, bounded exact text/instruct JSON, exclusive output and no overwrite, local safetensors/offline/no remote trust. Windows stdout uses ASCII JSON escapes to preserve exact Chinese for UTF8 consumers; saved manifest remains UTF8.36 independent checks passed (34 structural including Chinese roundtrip plus2 real Windows junction checks); dependency-free help passes. No broad TypeScript rerun for pure Python module.

Actual synthesized private samples data/acceptance/local-tts/gentle-pilot/output.wav (4.88s,48.452s inference),cheerful-pilot/output.wav (4.32s,42.061s), formal worker-gentle/output.wav (5.92s,57.735s inference plus14.515s imports/load). All24kHz monoFLOAT finite, independently measured frames and browser metadata pass. Pilot blocks socket connections after imports, succeeds offline. Same original fictional sentence and Serena voice with requested gentle/cheerful instructions; owner listening, full-text delivery and achieved emotion remain NOT verified. No timestamps/intensity/pace/pause precision. Generated TTS is output only, never human-recorded input acceptance or recovered owner transcript.

README has rerun command; output folder must be new/empty. CPU RTF about10, insufficient for fluid dialogue currently. GPU/quantization/offload, Jev expression mapping and Gemini->Jev->TTS orchestration not implemented. Prior persona memory/reply/input backlogs unchanged, and owner deferred real input text/phonetic listening. Do not assume completed emotion synthesis quality or final persona voice.

TTS worktree cleaned only after saving four Luna reports under .runtime/harness-runs/local-tts-worker/harness-runs; accepted files committed in main. Keep existing E:/mutsumi/jev-quota-worker (HEAD0f08afd) unaccepted quota-adapter draft; no TTS helper/coder left running. Existing loopback8766/8767 input-review servers may still be open; TTS samples presented as local WAV players, no external publication.


### Latest owner direction: whole original audio + isolated speech (2026-10-03,D35/D36)

Owner requires custom timbre, rejects preset-only CustomVoice as final TTS solution, and explicitly postpones Qwen3-TTS versus IndexTTS comparison. Preserve existing trial outputs; no new TTS deployment or cloning. Current focus returns to input audio.

Owner says first separation seems fairly good and will supply more real recordings. This is preliminary subjective feedback on one sample; transcription/timing/emotion quality remains unaccepted. Do not synthesize input test recordings. New samples first support local mix/vocals/accompaniment comparisons and checking word-onset loss, distortion and leakage.

D36 adds whole original-audio analysis BEFORE isolated-speech analysis, retaining overall scene/features/music/environment/effects and non-lexical human sounds/unknown. Use original waveform evidence, not accompaniment alone. Both whole context and speech text/available timing/voice cues go to bounded context for Gemini with stable owner persona/rules/selected memory; Jev remains reply-expression decision only. First whole-stage candidate reuses already selected Gemini audio route; no cloud calls this turn. New whole-specific output/context merge/sequence/actual reply remain unimplemented. Missing event times/confidence stay unknown, conflicting original/vocal transcriptions remain independent, no guesses promoted to persona rules or durable facts.

Updated docs/input-vocals-onsets-design.md and D36; current target diagram appended to voice-system-flow.md with explicit not-implemented label, historical diagram retained. Initial automatic-review rejection of total-diagram rewrite was resolved by readonly verification of supervisor design authority and the actual AGENTS prohibition against changing architecture to make implementation appear compliant; approved append completed. No application code, criteria or global settings modified. All files individually committed locally, no push.

### 原音整体分析与两个新样例（2026-10-03，D36/D37）

用户明确允许提供录音上云。Luna 已新增 application/whole-audio-ports.ts 与 providers/ohmygpt/ohmygpt-whole-audio.ts，逐文件提交合入main；监督主仓库42项契约/26项传输检查、TypeScript构建、287项既有回归均通过。[模块验收](reviews/M02-whole-audio.md)。固定OhMyGPT gemini-3.8-flash；整体结果original_mix，场景/事件均为候选，无事件时间或评分。完整双结果上下文、生产顺序编排、人声观察/句子定位/逐字起点推理仍未接入。不要把私有QA联合结果当生产上下文实现。

两个新真人样例fumo与衣柜已离线CPU HTDemucs分离：实际26.749s/9.900s，推理17.261s/7.670s，未按MP3头部估计帧数补时。原混音、人声、伴奏、16k人声分析及manifest在ignored data/acceptance/owner-fumo、owner-wardrobe 的 separation-001。监督先做了本地分离，再执行原音整体分析与已有分离轨转写；尚未验收完整“整体分析后重新分离”的生产链路。[真人样例记录](reviews/M02-owner-two-audio-pilot.md)。

第一次四次云端尝试连接超时无HTTP响应，记录run001；诊断并仅在QA子进程启用既有.env OHMYGPT_PROXY_URL后，明确有界第二轮四次HTTP200、全部结果严格映射通过，无自动重试/替代模型。private whole-analysis-002、vocals-transcription-002保留原始响应/usage/结果；combined-context-qa-002.json保留双来源、冲突与能力缺口。不能确认第一次失败的服务端接收/计费。私有analysis-plan已更新D37授权及实际状态。原始音频不发送给编码模型。没有付费回复/Jev调用、系统代理或模型部署变更。

质量仍待真人核对：衣柜整体模型声称器乐，与用户“含人声BGM”标签不一致；fumo整体室内线索与人声阶段户外线索冲突。人声分离不保证前景说话者与背景歌手隔离。转写未获得human-reference，不自动定稿，不将场景/性别/地点猜测写入记忆，不造时间戳。

私人试听页 http://127.0.0.1:8768/（若仍运行），QA服务 .runtime/qa/owner-two-listening-server.mjs；六条音轨Edge元数据检查通过且截图已检查。静态报告 data/acceptance/owner-two-listening.html。换设备复制所需ignored私有材料后重开QA服务，不能期待本机进程迁移。Luna三次编码报告在.runtime/harness-runs/whole-audio-worker/harness-runs，经哈希备份校验后本任务工作树已移除；Jev未验收工作树仍保留。所有提交仅本地，无push。下一步实现双来源InputContextBundle/上下文编排，继续通过ChatGPT认证gpt-6-luna CLI逐文件实现；听审确认后推进句子/字起点和声学情绪。TTS仍按D35延期。

### 句子首尾本地候选（2026-10-03，D38）

用户已真人试听接受fumo和衣柜人声分离，当前转做分句；不等于原话/场景/时间/情绪验收。Luna实现并修复 tools/local-aligner/sentence_result.py，监督35项独立结构检查通过，逐文件提交合入main，详见[分句验收](reviews/M02-sentence-bounds.md)。两个原生本地对齐请求仍invalid_alignment，全部诊断保留；新句子mapper只独立提取有效句子首尾，不冒充旧完整逐字区间成功。

fumo按转写句末标点得到7个模型边界候选，真实采样裁剪7段可试听；句界听审仍待用户。衣柜无句末标点且末字零时长，仅保留一个single_span_unverified、bounds unavailable，不造边界。下一步需文字不变的语义分句提案/声学句尾定位，以及每句裁剪后本地逐字起点推理；目前mapper不加载模型，监督QA调用既有align.py，不是生产CLI已接线。私人输出在owner-fumo/owner-wardrobe的sentence-pilot-001。新试听 http://127.0.0.1:8769/（进程仍运行时），旧原音分离对照8768；9条音轨Edge元数据检查和页面截图通过不等于听审。

用户新提供中文人声素材_7段.zip已安全解包到ignored data/acceptance/owner-seven-001，7段约10s48k双声道PCM16，原始哈希/帧数在inputs.json，source-notes.txt只作未核验来源说明。自动审批拒绝新14次云端计划，尚未执行；用户随后转本地分句，七段未做分离/云端识别。不要自行绕过拒绝。全部密钥/录音/QA原始响应保持忽略，不推送。Luna无写入启动/编码问题、原稿恢复和后续修复完整证据另存主仓库.runtime/harness-runs/sentence-worker及.runtime/qa。

### 衣柜三句与长停顿自动分句（2026-10-03，D39/D40）

用户确认fumo7句试听没有问题，衣柜原来只显示整段不算分句。随后用户给出三句参考并要求较长停顿分句。Luna扩展sentence_result.py支持原文精确拼接的外部分句+来源；新增pause_sentences.py，默认600ms的本地原生单位间隙提出分句、可调100..3000ms。监督16项新接口/35项原有边界/25项停顿检查通过，已逐文件单独提交。详见[衣柜修复验收](reviews/M02-wardrobe-pause-sentences.md)。默认阈值是初始工程值，模型词间时间不是人工声学参考或完整VAD；生产CLI仍未接线。

停顿算法仅用原文和全段原生时间，自行得到与用户参考完全一致三句，两个候选间隙720/1440ms，原文空格/标点逐字保留。第三句原全段末字零区间仍拒绝；一次本地Qwen CPU局部真实人声推理得到末字正区间，按实际119200sample裁剪偏移加回，第三句候选7.61..9.85s，窗口7.45s起点未充当句界。最终三句0..2.56s、3.28..6.16s、7.61..9.85s，均实际采样裁剪。owner-wardrobe/sentence-pilot-002是人工分句参考/局部推理证据，sentence-pilot-003实际由自动停顿模块驱动，保留全段拒绝和局部原生证据。

8769最新运行QA服务 .runtime/qa/sentence-listening-server-003.mjs，静态报告data/acceptance/sentence-pilot-003-listening.html；用户需刷新原页即可见衣柜三句。fumo7句保留；全页12条音轨Edge元数据检查通过。衣柜新句首尾仍待试听，不把分句文本一致当声学正确。不再需要此前计划的Gemini语义提案，本轮无云端调用、无新七段处理、无TTS/Jev变更。下一步推进逐句字符起点推理/输入情绪与双结果上下文；音频阶段应保持原文和局部裁剪时钟证据。

本任务Luna记录已复制到主仓库.runtime/harness-runs/semantic-sentence-worker/harness-runs并逐文件哈希验证，已合入且干净的工作树移除；未验收Jev工作树保留。应用源码仍仅Luna CLI编写，监督QA在忽略目录；本地提交不push。

### 通用自主分句worker，参考只用于事后验收（2026-10-03，D41）

用户澄清标准三句是目标，运行流程不能由人工答案驱动。此前QA虽自动提出parts，句尾仍复用样例专门缓存，已明确不算通用流程。Luna已完成tools/local-aligner/sentences.py：只需音频+转写+通用参数，模型一次加载，全段新推理后自动标点/长停顿分句，对合格无效句子自动从模型首字/下一句首字和150ms窗余量选裁剪窗口并局部新推理，无case/参考/预设数量/缓存输入。原文与诊断保留，无法定位不造时间，输出独占。共享原生词无论拒绝reason都禁止重切。23项结构检查和两个真实独立推理通过，详见[通用worker验收](reviews/M02-automatic-sentence-worker.md)，README有直接CLI命令。

新私人结果data/acceptance/automatic-sentences-001，inputs采用中性名字。主仓库实际程序读取审计禁止参考和旧私人结果，两次运行zero blocked reads；native I/O不声称全拦截，源码/API复查共同确认无参考依赖。事后监督才读用户标准比较。实际fumo7句/25.947s，衣柜3句/23.932s；衣柜第三句自动选择119200..158407sample推理窗，来源是本轮coarseunit和通用margin，没有喂固定时间。逐段实际音频帧数匹配、有限且mono16k；WAV容器字节不同，但全部解码浮点采样与之前片段完全一致。fumo既有听审认可不扩展为全面ASR/情绪验收。

8769最新服务.runtime/qa/automatic-sentence-listening-server-final.mjs，静态报告data/acceptance/automatic-sentences-001-listening-final.html，展示两次通用程序新结果而非旧QA剪辑。12条音轨metadata通过；刷新原页查看。结构mock不当真人质量，全生产音频入口和更广泛样本、逐字起点、输入情绪仍待实现。无需新云调用，七段云审批拒绝仍延期。标准答案不放模型输入/编码提示；本地逐文件提交，无push。

本任务工作树编码报告已复制并逐文件哈希校验到.runtime/harness-runs/automatic-sentence-worker/harness-runs，清理已合入干净工作树，Jev未验收工作树保留。监督QA审计/推理/结果对照脚本均在.runtime/qa、私人数据ignored，换设备如需复用应私下搬迁且重建虚拟环境，不expect正在运行进程迁移。

### 每句字头占用区间与后续输入情绪（2026-10-03，D42）

用户明确先分句、再在每句内部定位字/词开头、相邻起点形成占用区间，随后分析情绪。Luna新增tools/local-aligner/character_starts.py及providers/ohmygpt/ohmygpt-emotion.ts并经监督修复，所有tracked写入立即单文件提交，仅本地。独立验收见reviews/M02-character-starts-emotion.md，README有运行命令。字头17+7检查通过，真实fumo7/衣柜3逐句CPU离线推理154原生units/149正占用cells，重合起点分组，Fumo整词保留；衣柜第二句我/把重合，不伪造独立字头。没有单位end_ms，独立占用metadata包含停顿、末块到既有句尾；invalid/reversed/mismatch不生成有效cells。最终校验对两段真实输入通过，十句纯view重建与保存原生结果完全一致，未重复真实推理冒充新结果。

输入情绪适配器36项独立结构/传输检查、完整TS构建及287现有回归通过，固定OhMyGPT gemini-3.8-flash、单次有界POST无回退/重试。EmotionInput只用原文/已有句界/IDs省略units，不把起点占用区间塞入旧发音Timing。D37已有提供录音上云授权下，本轮仅两段分离真人声音各一次：HTTP200,fumo7候选(首句happy其余neutral)耗时10484ms,衣柜3neutral耗时6553ms。原文/句界全保留，没有评分/逐字情绪。音频modality usage是服务返回声明，不当upstream独立真实性证明。字头准确性/情绪/原话仍待真人听审，production整段输入CLI和双来源上下文编排未接线。

ignored data/acceptance/character-starts-001有output-1/output-2真实字头结果和emotion-1/emotion-2原始响应、projection、结果、hash/调用metadata。私人QA脚本/测试/logs在.runtime/qa。最新试听 http://127.0.0.1:8770/，.runtime/qa/character-starts-listening-server.mjs（当前session23139）显示10句播放器/149字块/中文候选情绪；浏览器10条duration真实通过且0零长块。数据静态listening.html随服务启动刷新。8769分句/8768原音对照保留，不expect进程迁移；仅本机服务，无系统代理/pagefile/driver改动。

编码前几轮遇到主仓库ACL、裸python不可用及命令转义/锚点失败；无source写入时保留失败日志，Luna错误总结不当检查成功。所有应用源码最终由指定Luna在E:/mutsumi/onsets-emotion-worker完成，监督独立审查通过后合入。完整运行报告保存并哈希验证后清理本轮工作树；未验收E:/mutsumi/jev-quota-worker仍保留。没有push，私有音频/凭据不发送编码模型。七段素材云审批拒绝仍延期，TTS自定义音色比较继续暂缓。

下一步先等用户试听字头/情绪反馈，修复一般能力而非喂样例标准答案；随后按任务继续生产CLI双来源上下文/人格与真实回复/记忆，Jev仅回复表达。不要宣称声学精度已经human accepted或整套生产语音程序已接通。

### 本地人声统一 CLI（2026-10-04，D43）

真实仓库 E:/mutsumi/mutsumi。tools/analyze-vocals.mjs 已接已分离mono16k WAV+完整原文 -> 自动分句 -> 每句新字头推理 -> 可选输入情绪。监督接受本地部分，41项独立检查通过（34结构+7子进程），adapter无请求导入和语法通过。详见 reviews/M02-vocals-cli.md，README含本机命令。原音整体/分离/ASR、双来源人格上下文、记忆和自定义音色TTS仍不在这条入口内。

本机重新只读核验 XeonE5-2673v3 12/24，RAM33390216KiB/free26642880KiB，RTX2060 6144MiB/driver591.44/free5361MiB（不同时间快照），D pagefile2048MB/usage0，E约589MB/C约3.34GB bytes空余。Node24.19.0/alignerPython3.12.14/Torch2.10.0+cpu，现有本地权重复用，无CUDA/页面文件/系统代理更改。不要当其他设备事实迁移。

一次新衣柜真人 LOCAL CLI run（不含 --emotion）在 ignored data/acceptance/vocals-cli-live-local-001；exit0/partial，耗时99.342s，其中首次句子模型加载66.998s，字头模型加载13.934s。自动3句在运行结束后才读标准比较，一致；40原生单位/39正占用cell/1重合组，不强拆我/把，实际三段裁剪40960/46080/35840frames匹配。3句边界0..2560、3280..6160、7610..9850ms仍模型候选；全音158407frames/16k，rounded9900ms。原始快照SHA校验通过；所有私有计时/检查/来源在 .runtime/qa/vocals-cli-*，不提交素材。声学字头/情绪真人听审未完成。

最新8770 QA服务 .runtime/qa/character-starts-listening-server.mjs/session16265，衣柜改用本次CLI新结果，显示情绪本次未请求；Fumo保留上轮候选。10条浏览器真实duration元数据/149cells/0零长块通过。重开页面需刷新；迁移需私下搬运ignored材料及重建环境，不能复制进程/绝对venv路径。旧8768/8769不保证还运行。

本轮 CLI --emotion 真云验收未执行：自动审批两次在启动前拒绝，认为泛称云端和文档/既有记录未提供目的地直接授权；已通过async问用户明确确认“衣柜分离轨 -> https://api.ohmygpt.com/v1/chat/completions / gemini-3.8-flash一次”。尚无答案，不能把时间经过视为批准；不得绕过、换脚本上传或借旧情绪响应伪造本次成功。原拟 .runtime/qa/vocals-cli-live.mjs/data/acceptance/vocals-cli-live-001 未执行/未创建。批准后才做具体云验收；如果拒绝，保持本地分析。七段素材云拒绝仍独立延期。

应用代码所有写入均经过指定ChatGPT认证 gpt-6-luna CLI配置，监督逐文件立即单独提交，坏草稿也先提交再修复，最终主源码23c299c。生成总结偶有自称其他模型，不作为独立实际backend证明；harness --check确认ChatGPT认证和CLI指定模型。10轮完整编码报告复制到主 .runtime/harness-runs/vocals-cli-worker/harness-runs，每文件SHA256验证；最终源码Git blob fcc0a2dfd9b0b16896d363b451d796c2e889012b一致（工作区仅LF/CRLF差异）。本轮干净已合入 E:/mutsumi/vocals-cli-worker 已移除，Jev未验收 E:/mutsumi/jev-quota-worker保留。主仓库本地提交，无push，密钥/录音/QA均ignored。

### 细致输入语气与情绪（2026-10-04，D44）

用户认为中性描述过泛，要求心理学／语言学和现成实现调研后实现细分析。参考和工程选择见 input-vocal-affect-design.md；独立验收见 reviews/M02-vocal-affect.md。已由指定 ChatGPT 认证 gpt-6-luna CLI 完成三个应用文件：application/vocal-affect.ts、providers/ohmygpt/ohmygpt-emotion.ts、tools/analyze-vocals.mjs。逐文件写入立即单独本地提交，无push，源模型配置不当独立 backend 证明。主仓库已合入全部应用源；旧正负标签草稿先提交后修复回原8类。

--emotion 现在同一次 OhMyGPT gemini-3.8-flash 音频请求输出逐句语气、声音表现、情绪标签、valence/arousal、维度依据、未知与干扰，不改原文／句界／字头、不新增评分或伪造测量。旧 adapter 默认 detailed=false 保持兼容，CLI 强制 detailed=true 且验证／克隆 vocal_affect、核对粗标签后保存；缺失/不可信细分析失败保留本地阶段，不回退仅 neutral。模型听感不是声学 Hz/dB 或心理诊断，不写人格/身份/意图/记忆事实。whole-scene、人格/长期记忆/回复/Jev/TTS仍分开。

最终独立检查43新契约/adapter+36兼容+37CLI+7子进程=123全部通过；root TS noEmit及build通过，287tests/19suites全过、0fail/skip。全部新测试为明确合成结构／假worker，不充当真人验收；coder独立file tsc曾Buffer类型失败，root配置的监督检查才是通过依据。ignored .runtime/qa各JSON、vocal-affect-regression.txt保留实际结果。未重新本地录音推理或上传音频。用户先前“效果还不错”只保留定性反馈。

8770私有QA服务 .runtime/qa/character-starts-listening-server.mjs/session43980 已增加安全转义的细致展示区：10句真实音轨均细分析待执行，Fumo保留历史粗情绪，衣柜使用既有新本地CLI字头。10音轨metadata、149cells/0零长及恶意字符串合成转义检查通过；截图 vocal-affect-wardrobe-ui.png 已独立看布局。服务优先选择 data/acceptance/vocals-affect-live-001（若未来真实运行完成），否则旧本地CLI。迁移进程不保证继续，须重启。

云端真实细分析仍待具体目的地批准：D43自动审批已拒绝此前衣柜上传两次，不能用旧泛称授权绕过。完成可审查实现后已async询问该衣柜分离轨发送 https://api.ohmygpt.com/v1/chat/completions / gemini-3.8-flash 一次。尚无直接答案；.runtime/qa/vocal-affect-live.mjs 已准备但未执行，预期新output data/acceptance/vocals-affect-live-001。若批准只执行一次，保留失败、无自动重试，再审真实中文语气／依据／分离干扰；不能声称质量已通过。七段素材仍独立延期。

四轮 Luna 编码完整report已复制到 .runtime/harness-runs/vocal-affect-worker/harness-runs 并4文件SHA256逐一相同。三个最终source Git blob均与工作树一致：9683d825b55564b727bb7cb3d33d94a29fc37674 / d8ba1115e419be719051ac59d53d5e30cdf72b45 / 7c61029b362e71675f220c87a8f0c0704f05e5c7。已清理本轮干净 vocal-affect-worker，未验收 jev-quota-worker保留。E空余约522MB，不安装重型声学模型／改全局代理／页面文件／驱动。