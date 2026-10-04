# 成熟聊天核心接入：范围与选型草案（2026-10-05）

用户要求核对以前进度，并明确完整文本聊天组件：能模仿角色，带人格提示词、记忆、知识库、联网搜索/视频等功能插件；优先采用成熟项目，不能把只借鉴概念和若干自写类型宣称完整聊天系统。用户本轮选择首个验收人格为原创 Mutsumi。本文是监督设计/调研记录，尚未批准或部署具体框架，不冒充接通。

## 仓库实情

已验收 persona-card.ts 内部角色卡校验与提示编排（28结构检查），separated-reply.ts 文本生成后独立Jev表达编排（28结构检查），dialogue-context.ts 近期最多6轮预算及FileConversationStore原轮次/配置/播放状态。仅有输入Gemini音频适配器，没有独立Gemini TextReplyPort HTTP实现或融合JSON到角色回复CLI。无持久化长期MemoryPort、知识库检索、用户角色工具循环、搜索或视频工具。旧dev mock和第三方工具可供监督使用不等于角色具备这些能力。旧 persona-memory-community-design.md 是2026-10-02的概念草案，当时确实未交付完整核心。

## 成熟项目核对与建议

候选AstrBot：官方 https://github.com/AstrBotDevs/AstrBot ; 当前官方文档证实已有persona/provider/会话管理、上下文压缩、知识库、function-calling搜索和MCP/插件；AGPL-3.0仓库，未复制/安装代码。作为独立本地聊天服务复用其真实组件，Mutsumi只写输入/输出连接及验收，不自行重造完整agent/RAG/插件框架。
- HTTP入口官方 https://docs.astrbot.app/en/dev/openapi.html ：v4.18.0起APIKey HTTP接口，POST /api/v1/chat必须username；本地OpenAPI与scope需要安装后核对，不能猜JSON字段或在此阶段编造SDK兼容。
- 人格/AI与插件： https://docs.astrbot.app/dev/star/guides/ai.html ; 原创Mutsumi先用所有者设定，未来允许替换角色。不把角色虚构经历当真人记忆。
- 历史压缩 https://docs.astrbot.app/en/use/context-compress.html ：截轮/LLM摘要两种，摘要可能额外调用；截断或摘要不是完整长期事实记忆。
- 知识库 https://docs.astrbot.app/en/use/knowledge-base.html ：需embedding provider，可选reranker；当前没有选定embedding，不能声称Gemini对话key自然满足知识库所有依赖。先列明所需服务/额度/本地模型体积，再配置；保持知识资料和个人记忆分开。
- 搜索 https://docs.astrbot.app/en/use/websearch.html ：function calling并依赖搜索provider配置/凭据。Codex监督的web工具不会自动变成项目插件。搜索结果有来源、工具失败可见；未选择服务前不默认付费调用。
- 持久长期记忆：原生会话管理加摘要不冒充跨会话事实检索。先评估可维护成熟插件或可独立接入的Mem0/Letta服务，核对当前API/依赖与纠正/遗忘/来源/作用域；未完成对照验收前不标memory_ready。当前发现的AstrBot记忆插件只能算待审候选，不能凭README宣传选最成熟。

候选SillyTavern：继续参考成熟角色卡/世界书与角色对话管理。官方 https://docs.sillytavern.app/usage/core-concepts/data-bank/ 有分角色/全局/会话知识附件， https://docs.sillytavern.app/extensions/chat-vectorization/ 与 https://docs.sillytavern.app/extensions/summarize/ 为检索和摘要参考。 https://docs.sillytavern.app/extensions/websearch/ 为扩展搜索。其DataBank视频能力包括下载YouTube字幕，不能声称该行为等于直接理解画面。此轮建议AstrBot作为程序化聊天核心候选、SillyTavern作为角色配置参考；这是工程适配判断，不是品质排行榜，也未修改既有Gemini/Jev选择。

## 两个入口，一个对话核心

text_chat输入 user_id/session_id + text，不依赖音频模块。audio_chat输入已验证的融合音频数据，经轻量投影进入相同核心。人格、历史、长期记忆、知识检索和工具都由同一核心服务管理；不要维护两套不一致的记忆。现有fused-preview.json是监督展示，不是正式生产契约，接入前必须版本化/校验/预算。

供模型的数据：原始用户文字、原音场景与声音候选、人声片段的语气/情绪摘要、未知和来源。完整字头留在结构化记录，只有需要定位某句或指代声音时才选相关时间，不每轮把24单位/所有raw诊断/文件系统路径全塞提示词。音频文本/检索资料/工具返回作为引用数据，不能改写所有者人格规则；背景猜测与片段情绪不写成用户稳定事实。

核心输出接口目标为 reply_text（自然口语、适合TTS）、独立 references/tool_trace 与memory_actions记录；这些旁路字段不交TTS朗读。角色口吻允许不同意、澄清和不记得，不能假装已经调用工具。Gemini负责原文，Jev后续决定同一原文表达，保持D30，无正文里的虚构测量/时间/表情控制标签。文本模式仅输出正文；语音模式用相同正文进入Jev/TTS。不因视频/搜索工具加入而改写输入人声边界。

视频拆成明确能力：字幕/转写理解；抽帧/视觉理解；音轨声音理解。本地文件与链接权限/可访问性不同，支持某个平台字幕不等于任意Bilibili/YouTube视频都可完整读取。未选取实际成熟工具并用真实视频验收前 capability unavailable，不假称已经看过。

## 首个原创人格及验收

沿用既有原创Mutsumi样稿：温柔安静、说话具体且有自己看法；中文口语、不机械每轮追问或安慰、不要客服套话；只能依据真实记录说我记得，不把示例/角色故事/模型情绪猜测写成事实。所有者设定可编辑/版本化，后续新增角色不换聊天核心。

验收必须分别报告：纯文本多轮会话、跨进程历史；重启后检索明确记忆、纠正和删除；角色知识资料召回并附来源；一次实际搜索成功/失败；视频字幕与实际视觉理解分别成功/失败；已处理第03真人JSON进入角色生成自然口语正文，正文独立于Jev表情；未播放的TTS不声称用户听过。模拟只验证格式，实际调用/数据检索是另一次证据。

## 环境与下一实施边界

本轮只读快照E438763520bytes/C1497415680/D13586128896。AstrBot官方requirements包含FAISS/pandas/providerSDK/多个平台库，安装体积尚未实测，不用猜数声称能在E部署。后续应指定独立运行目录、固定框架版本/依赖、估算安装空间；不删除现有声音模型或污染aligner/separator环境。尚未选安装目录、未下载框架/新模型、未配置新search/embedding服务、未提交真实对话/录音给新服务。

应用接线/插件仍由ChatGPT认证gpt-6-luna Codex CLI单文件实现，每个tracked写入立即单独本地提交，监督负责设计和独立验收。不是把现有基础模块重写成另一套自造聊天系统。先确定成熟核心部署与实际API，再委派薄连接任务；不能只写一个Gemini POST加6轮history就宣称完整机器人。