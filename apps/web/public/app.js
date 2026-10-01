(function () {
  'use strict';
  const MAX_BYTES = 10485760;
  const MAX_RECORD_MS = 29500;
  const POLL_INTERVAL_MS = 600;
  const POLL_DEADLINE_MS = 130000;
  const POLL_FETCH_TIMEOUT_MS = 5000;
  const UPLOAD_TIMEOUT_MS = 15000;
  const PREVIEW_META_MS = 5000;
  const SUPPORTED_EXT = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.webm'];
  const $ = (id) => document.getElementById(id);
  const el = {
    modeBadge: $('mode-badge'), modeBanner: $('mode-banner'), providerStatus: $('provider-status'),
    record: $('record-button'), stop: $('stop-button'), time: $('recording-time'),
    file: $('file-input'), upload: $('upload-button'), retry: $('retry-button'),
    status: $('status'), error: $('error'), stages: {},
    resultSection: $('result-section'), originalAudio: $('original-audio'),
    transcript: $('transcript'), unitCount: $('unit-count'), tokenGrid: $('token-grid'),
    selection: $('selection-detail'), observations: $('observations'), capabilities: $('capabilities'),
    replySection: $('reply-section'), replyText: $('reply-text'), replyPlan: $('reply-plan'),
    assistantAudio: $('assistant-audio'), outputTiming: $('output-timing'),
    playbackStatus: $('playback-status'), export: $('export-button'), clear: $('clear-button'),
  };
  document.querySelectorAll('[data-stage]').forEach((li) => { el.stages[li.getAttribute('data-stage')] = li; });
  const CODE_TEXT = {
    invalid_input: '输入无效，请检查音频格式、时长或大小。',
    busy: '服务器正在处理另一轮请求，请稍候。',
    not_found: '未找到对应的任务或记录。',
    provider_unavailable: '当前分析或生成能力不可用，请稍后重试或改用可用配置。',
    cancelled: '本轮处理已取消。',
    timed_out: '本轮处理超时。',
    provider_failed: '远端处理失败。',
    invalid_result: '返回结果结构无效。',
    storage_failed: '本地记录存储失败。',
  };
  const GENERIC_ERROR = '请求失败，请稍后重试。';
  let gen = 0, state = 'idle', health = null, sessionId = null;
  let micStream = null, mediaRecorder = null, recChunks = [], recMime = null, recStart = 0;
  let elapsedTimer = null, safetyTimer = null, pollTimer = null, pollDeadline = 0;
  let pendingBlob = null, pendingName = 'audio', pendingRequestId = null, pendingRetry = null;
  let currentJobId = null, lastRecord = null, lastTurnId = null, selectedFile = null;
  let activeUnits = [], previewEndSec = 0, pageHidden = false;
  let previewSerial = 0, previewLoadedHandler = null, previewMetaTimer = null, previewFallbackTimer = null;
  function bump() { gen += 1; }
  function fresh(g) { return g === gen; }
  function isBusy() { return state === 'submitting' || state === 'processing' || state === 'playing-reply'; }
  function isPipelineActive() { return state === 'requesting-microphone' || state === 'recording' || isBusy(); }
  function applyControls() {
    const ready = !!sessionId && !isPipelineActive();
    el.record.disabled = !ready;
    el.stop.disabled = state !== 'recording';
    el.upload.disabled = !ready || !selectedFile;
    el.file.disabled = isPipelineActive();
    el.retry.hidden = !pendingRetry || state !== 'idle';
    el.retry.disabled = state !== 'idle';
    el.clear.disabled = state === 'requesting-microphone' || state === 'recording' || state === 'submitting' || state === 'processing';
    el.export.disabled = !lastRecord;
  }
  function setRetry(v) { pendingRetry = v; applyControls(); }
  function setState(s) { state = s; applyControls(); }
  function setStatus(m) { el.status.textContent = m; }
  function showError(m) { el.error.textContent = m; el.error.hidden = false; }
  function hideError() { el.error.textContent = ''; el.error.hidden = true; }
  async function requestJSON(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      let data = null;
      try { data = await res.json(); }
      catch (e) { if (ctrl.signal.aborted || (e && e.name === 'AbortError')) throw e; data = null; }
      return { res: res, data: data };
    } finally { clearTimeout(t); }
  }
  function initFailure() {
    el.modeBadge.textContent = '模式状态：未能加载。';
    el.providerStatus.textContent = GENERIC_ERROR;
    showError('服务器会话初始化失败，请点击"重试"重新初始化。');
    setStatus('会话未就绪。');
    setRetry({ kind: 'init' });
  }
  async function init() {
    applyControls();
    el.stop.textContent = '结束并分析';
    const g = gen;
    try {
      const out = await requestJSON('/api/health', { method: 'GET' }, POLL_FETCH_TIMEOUT_MS);
      if (!fresh(g)) return;
      if (!out.res.ok || !out.data) { initFailure(); return; }
      health = out.data;
      renderMode();
      sessionId = health.session_id || null;
    } catch (e) { if (!fresh(g)) return; initFailure(); return; }
    if (!fresh(g)) return;
    try {
      const out2 = await requestJSON('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, UPLOAD_TIMEOUT_MS);
      if (!fresh(g)) return;
      if (out2.res.ok && out2.data && typeof out2.data.session_id === 'string') sessionId = out2.data.session_id;
    } catch (e) { if (!fresh(g)) return; }
    if (!fresh(g)) return;
    if (!sessionId) { initFailure(); return; }
    setRetry(null); setStatus('等待提交音频。');
  }
  function providerLabel(name, info) {
    if (!info || !info.status) return name + '：未知';
    if (info.status === 'development-mock') return name + '：开发 mock（不产生真实结果）';
    if (info.status === 'configured') return name + '：仅完成配置，实际验证待进行';
    return name + '：不可用（该能力尚未配置或验证）';
  }
  function renderMode() {
    if (!health) return;
    if (health.mode === 'development-mock') {
      el.modeBadge.textContent = '当前模式：开发模式（provider mock）';
      el.modeBanner.textContent = '开发模式：转写为固定测试文字、单元时间为固定的测试时间，均与录音内容无关；合成输出为静音占位，不进行真实的语音识别或生成。';
    } else {
      el.modeBadge.textContent = '当前模式：live';
      el.modeBanner.textContent = 'live 模式：provider 配置见下方状态；配置完成不等于已验证。';
    }
    el.providerStatus.textContent = [providerLabel('语音分析', health.analysis), providerLabel('对话生成', health.dialogue), providerLabel('语音合成', health.synthesis)].join('；') + '。每段音频上限 10 MiB、时长不超过 30 秒。';
  }
  function pickMime() {
    const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const m of list) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; }
    return '';
  }
  function stopStream(s) { if (s) s.getTracks().forEach((t) => t.stop()); }
  function releaseMic() { if (micStream) { stopStream(micStream); micStream = null; } }
  function clearRecTimers() { if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; } if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; } }
  async function onRecordClick() {
    if (state !== 'idle') return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { showError('此浏览器不支持麦克风录音，请改用下方"选择音频文件"上传。'); return; }
    bump(); pauseAssistant(); try { el.originalAudio.pause(); } catch (e) {} detachPreview(); setRetry(null);
    hideError();
    setState('requesting-microphone');
    setStatus('正在请求麦克风权限…');
    const g = gen;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
    catch (e) { if (!fresh(g)) return; setState('idle'); showError('无法访问麦克风，请检查权限或改用文件上传。'); return; }
    if (!fresh(g) || pageHidden) { stopStream(stream); return; }
    const mime = pickMime();
    if (!mime) { stopStream(stream); setState('idle'); showError('此浏览器不支持可用的录音格式，请改用下方"选择音频文件"上传。'); return; }
    micStream = stream; recChunks = []; recMime = mime;
    try { mediaRecorder = new MediaRecorder(stream, { mimeType: mime }); }
    catch (e) { releaseMic(); mediaRecorder = null; setState('idle'); showError('无法创建录音器，请改用文件上传。'); return; }
    mediaRecorder.ondataavailable = (ev) => { if (fresh(g) && ev.data && ev.data.size > 0) recChunks.push(ev.data); };
    mediaRecorder.onerror = () => { if (!fresh(g)) return; clearRecTimers(); releaseMic(); mediaRecorder = null; recChunks = []; setState('idle'); showError('录音过程中出错，请重试或改用文件上传。'); };
    mediaRecorder.onstop = () => { if (fresh(g)) finishRecording(); };
    setState('recording');
    setStatus('正在录音…点击"结束并分析"提交整段。');
    recStart = Date.now(); el.time.textContent = '0';
    elapsedTimer = setInterval(() => { if (!fresh(g)) return; el.time.textContent = String(Math.min(29.5, (Date.now() - recStart) / 1000).toFixed(1)); }, 200);
    safetyTimer = setTimeout(() => { if (fresh(g) && state === 'recording') stopRecording(); }, MAX_RECORD_MS);
    try { mediaRecorder.start(); }
    catch (e) { clearRecTimers(); releaseMic(); mediaRecorder = null; recChunks = []; setState('idle'); showError('无法开始录音，请重试或改用文件上传。'); return; }
  }
  function stopRecording() {
    if (!mediaRecorder || state !== 'recording') return;
    clearRecTimers();
    try { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); }
    catch (e) { mediaRecorder = null; recChunks = []; releaseMic(); setState('idle'); showError('结束录音失败，请重试或改用文件上传。'); return; }
    releaseMic();
  }
  function finishRecording() {
    const mime = (mediaRecorder && mediaRecorder.mimeType) || recMime || '';
    mediaRecorder = null;
    const blob = new Blob(recChunks, { type: mime });
    recChunks = [];
    if (state !== 'recording') return;
    if (blob.size === 0) { setState('idle'); showError('录音为空，请重新录制或改用文件上传。'); return; }
    if (blob.size > MAX_BYTES) { setState('idle'); showError('录音超过 10 MiB 上限，请缩短后再提交。'); return; }
    submitAudio(blob, mime.indexOf('ogg') >= 0 ? 'recording.ogg' : 'recording.webm');
  }
  function onFileChange() {
    if (isPipelineActive()) return;
    setRetry(null);
    selectedFile = el.file.files && el.file.files[0] ? el.file.files[0] : null;
    applyControls();
    if (selectedFile) setStatus('已选择文件，点击"上传所选文件"提交。');
  }
  function extOk(name) { const lower = String(name || '').toLowerCase(); return SUPPORTED_EXT.some((x) => lower.endsWith(x)); }
  function onUploadClick() {
    if (state !== 'idle') return;
    const f = el.file.files && el.file.files[0];
    if (!f) { showError('请先选择一个音频文件。'); return; }
    if (f.size > MAX_BYTES) { showError('文件超过 10 MiB 上限。'); return; }
    if (!extOk(f.name) && !String(f.type || '').startsWith('audio/')) { showError('文件类型可能不受支持；实际格式与时长将由后端校验。'); return; }
    submitAudio(f, f.name || 'audio');
  }
  function newRequestId() { return (window.crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : null; }
  function submitAudio(blob, name) {
    if (!sessionId) { showError('会话尚未就绪，请稍候后重试。'); return; }
    const rid = newRequestId();
    if (!rid) { showError('当前浏览器无法生成安全的请求标识，请改用支持加密 API 的浏览器上传音频文件。'); return; }
    pendingBlob = blob; pendingName = name; pendingRequestId = rid;
    doSubmit(blob, name, rid);
  }
  function buildForm(blob, name, rid) { const fd = new FormData(); fd.append('audio', blob, name); fd.append('client_request_id', rid); return fd; }
  async function doSubmit(blob, name, rid) {
    bump();
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    clearRecTimers();
    pauseAssistant(); detachPreview();
    currentJobId = null; lastRecord = null; lastTurnId = null;
    resetDisplay();
    setState('submitting'); hideError(); setStatus('正在上传音频…'); setRetry(null);
    const g = gen;
    let out;
    try { out = await requestJSON('/api/sessions/' + encodeURIComponent(sessionId) + '/turns', { method: 'POST', body: buildForm(blob, name, rid) }, UPLOAD_TIMEOUT_MS); }
    catch (e) { if (fresh(g)) ambiguousFailure(); return; }
    if (!fresh(g)) return;
    const res = out.res, job = out.data;
    if (job && typeof job.job_id === 'string' && (res.status === 202 || res.ok) && job.status !== 'failed') {
      currentJobId = job.job_id; lastRecord = job.record || null; lastTurnId = job.turn_id || (job.record ? job.record.turn_id : null);
      startPolling(job.job_id, g, job); return;
    }
    if (job && job.status === 'failed') { finishJob(job, g); return; }
    httpFailure(job);
  }
  function ambiguousFailure() {
    setState('idle'); setRetry({ kind: 'repost' });
    showError('提交结果未知，请求可能已送达服务器。重试将使用同一请求标识以避免重复处理。');
    setStatus('等待手动重试。');
  }
  function httpFailure(job) {
    setState('idle');
    const msg = (job && job.failure && CODE_TEXT[job.failure.code]) ? CODE_TEXT[job.failure.code] : GENERIC_ERROR;
    setRetry({ kind: 'newround' });
    showError('提交失败：' + msg); setStatus('等待手动重试。');
  }
  function startPolling(jobId, g, job) {
    setState('processing'); hideError(); setStatus('正在处理，请稍候…'); setRetry(null);
    pollDeadline = Date.now() + POLL_DEADLINE_MS;
    renderStages(job || null);
    schedulePoll(jobId, g);
  }
  function schedulePoll(jobId, g) { pollTimer = setTimeout(() => pollJob(jobId, g), POLL_INTERVAL_MS); }
  async function pollJob(jobId, g) {
    if (!fresh(g)) return;
    if (Date.now() > pollDeadline) { setState('idle'); setRetry({ kind: 'requery', jobId: jobId }); showError(CODE_TEXT.timed_out + '可继续查询状态（不会重新提交）。'); return; }
    let out;
    try { out = await requestJSON('/api/jobs/' + encodeURIComponent(jobId), { method: 'GET' }, POLL_FETCH_TIMEOUT_MS); }
    catch (e) { if (!fresh(g)) return; setState('idle'); setRetry({ kind: 'requery', jobId: jobId }); showError('查询处理状态失败。重试将继续查询，而不会重新提交音频。'); return; }
    if (!fresh(g)) return;
    const res = out.res, job = out.data;
    if (!res.ok || !job) { setState('idle'); setRetry({ kind: 'requery', jobId: jobId }); showError('查询处理状态失败。可重试继续查询。'); return; }
    renderStages(job);
    if (job.status === 'complete' || job.status === 'failed') { finishJob(job, g); return; }
    if (job.record) { lastRecord = job.record; lastTurnId = job.record.turn_id || lastTurnId; }
    schedulePoll(jobId, g);
  }
  function finishJob(job, g) {
    pollTimer = null;
    if (!fresh(g)) return;
    currentJobId = job.job_id; lastRecord = job.record || lastRecord; lastTurnId = job.turn_id || lastTurnId;
    renderStages(job);
    if (job.status === 'failed') {
      let retained = false;
      if (job.record) { renderResult(job.record); retained = true; }
      setState('idle'); setRetry({ kind: 'newround' });
      const msg = (job.failure && CODE_TEXT[job.failure.code]) ? CODE_TEXT[job.failure.code] : GENERIC_ERROR;
      showError('处理失败：' + msg); setStatus(retained ? '本轮部分结果已保留；可重新开始新一轮。' : '本轮未取得可保留的结果；可重新开始新一轮。'); return;
    }
    if (job.record) renderResult(job.record);
    setState('idle'); setRetry(null); setStatus('本轮处理完成。');
  }
  function onRetryClick() {
    if (!pendingRetry || state !== 'idle') return;
    hideError();
    if (pendingRetry.kind === 'init') { setRetry(null); init(); return; }
    if (pendingRetry.kind === 'requery' && pendingRetry.jobId) { startPolling(pendingRetry.jobId, gen, null); return; }
    if (pendingRetry.kind === 'repost' && pendingBlob && pendingRequestId) { setRetry(null); doSubmit(pendingBlob, pendingName, pendingRequestId); return; }
    if (!pendingBlob) { setRetry(null); return; }
    setRetry(null);
    const rid = newRequestId();
    if (!rid) { showError('当前浏览器无法生成安全的请求标识，无法重试。'); return; }
    pendingRequestId = rid; doSubmit(pendingBlob, pendingName, rid);
  }
  const STAGES = ['intake', 'analysis', 'context', 'dialogue', 'expression', 'synthesis', 'storage', 'complete'];
  const STAGE_LABEL = { intake: '音频接入', analysis: '语音分析', context: '上下文整理', dialogue: '对话生成', expression: '表达规划', synthesis: '语音合成', storage: '记录存储', complete: '完成' };
  function renderStages(job) {
    const rec = job && job.record ? job.record : null;
    const stages = rec && rec.stages ? rec.stages : null;
    const cur = job ? job.stage : (rec ? 'complete' : null);
    STAGES.forEach((s) => {
      const li = el.stages[s]; if (!li) return;
      let suffix = '（等待）';
      if (stages && stages[s]) {
        const st = stages[s].status;
        if (st === 'ok') suffix = '（完成）'; else if (st === 'unavailable') suffix = '（不可用）'; else if (st === 'skipped') suffix = '（已跳过）'; else if (st === 'failed') suffix = '（失败）';
      } else if (cur === s) {
        suffix = (job && job.status === 'failed') ? '（失败）' : '（进行中）';
      }
      li.textContent = STAGE_LABEL[s] + suffix;
    });
  }
  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function addText(node, text) { node.appendChild(document.createTextNode(text)); }
  function renderResult(rec) {
    el.resultSection.hidden = false;
    if (currentJobId && rec.source_asset && rec.source_asset.asset_id) {
      el.originalAudio.src = '/api/jobs/' + encodeURIComponent(currentJobId) + '/audio/' + encodeURIComponent(rec.source_asset.asset_id);
    }
    el.transcript.textContent = (rec.annotation && rec.annotation.transcript) ? rec.annotation.transcript : '转写文本不可用。';
    renderUnits(rec); renderObservations(rec); renderCapabilities(rec); renderReply(rec);
  }
  function renderUnits(rec) {
    clearChildren(el.tokenGrid); activeUnits = []; el.selection.textContent = '尚未选择单元。';
    const ann = rec.annotation;
    if (!ann || !Array.isArray(ann.segments) || ann.segments.length === 0) {
      el.unitCount.textContent = '0';
      const p = document.createElement('p'); addText(p, '词元数据不可用。'); el.tokenGrid.appendChild(p); return;
    }
    let count = 0, anyUnits = false;
    ann.segments.forEach((seg) => {
      if (Array.isArray(seg.units) && seg.units.length > 0) {
        anyUnits = true;
        seg.units.forEach((u) => {
          const idx = activeUnits.length; activeUnits.push({ unit: u, segment_id: seg.segment_id }); count += 1;
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'token'; b.setAttribute('data-unit-index', String(idx)); b.setAttribute('aria-pressed', 'false');
          const t = u.timing;
          addText(b, u.text + '（' + (t && t.status === 'available' ? (t.start_ms + '-' + t.end_ms + 'ms') : '时间不可用') + '）');
          b.addEventListener('click', () => selectUnit(idx));
          el.tokenGrid.appendChild(b);
        });
      } else {
        const p = document.createElement('p'); addText(p, '片段 ' + seg.segment_id + '：逐字词元不可用。'); el.tokenGrid.appendChild(p);
      }
    });
    el.unitCount.textContent = String(count);
    if (!anyUnits) { const p = document.createElement('p'); addText(p, '全部片段均未提供逐字词元（不可用）。'); el.tokenGrid.appendChild(p); }
  }
  function granLabel(g) { return g === 'character' ? '字' : '词/子词'; }
  function selectUnit(idx) {
    el.tokenGrid.querySelectorAll('.token').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    const node = el.tokenGrid.querySelector('[data-unit-index="' + idx + '"]');
    if (node) node.setAttribute('aria-pressed', 'true');
    const entry = activeUnits[idx]; if (!entry) return;
    showSelectionDetail(entry); playPreview(entry.unit);
  }
  function relevantEmotions(entry) {
    const rec = lastRecord; const out = [];
    if (!rec || !rec.annotation || !Array.isArray(rec.annotation.observations)) return out;
    const t = entry.unit.timing;
    rec.annotation.observations.forEach((o) => {
      if (o.kind !== 'emotion') return;
      let related = false;
      if (Array.isArray(o.segment_ids) && o.segment_ids.indexOf(entry.segment_id) >= 0) related = true;
      if (!related && t && t.status === 'available' && o.timing && o.timing.status === 'available' && o.timing.start_ms < t.end_ms && t.start_ms < o.timing.end_ms) related = true;
      if (related) out.push(o.label);
    });
    return out;
  }
  function showSelectionDetail(entry) {
    clearChildren(el.selection);
    const u = entry.unit, t = u.timing, parts = [];
    parts.push('文本：' + u.text);
    parts.push('粒度：' + granLabel(u.granularity));
    if (t && t.status === 'available') {
      let est = '';
      const srcStr = String(t.source || '');
      if (health && health.mode === 'development-mock') est = '（固定测试时间，与录音无关，非模型估计/非测量）';
      else if (srcStr.indexOf('model-estimate') >= 0) est = '（模型估计时间，非强制对齐/非测量）';
      parts.push('时间：' + t.start_ms + '-' + t.end_ms + 'ms，时长 ' + (t.end_ms - t.start_ms) + 'ms');
      parts.push('时间来源：' + t.source + est);
    } else {
      parts.push('时间：不可用（' + (t && t.reason ? t.reason : '未提供') + '）');
    }
    const emo = relevantEmotions(entry);
    parts.push(emo.length ? ('相关片段候选情绪：' + emo.join('、') + '（情绪归属片段，非逐字词独立判定）') : '相关候选情绪：无');
    parts.forEach((p, i) => { if (i > 0) addText(el.selection, ' '); addText(el.selection, p); });
  }
  function timingText(t) { if (!t) return '时间不可用'; if (t.status === 'available') return t.start_ms + '-' + t.end_ms + 'ms'; return '时间不可用（' + (t.reason || '未提供') + '）'; }
  function provText(provider, model) { const bits = []; if (provider) bits.push(provider); if (model) bits.push(model); return bits.length ? bits.join('/') : '未知来源'; }
  function renderObservations(rec) {
    clearChildren(el.observations);
    const obs = rec.annotation && Array.isArray(rec.annotation.observations) ? rec.annotation.observations : [];
    if (obs.length === 0) {
      const caps = rec.annotation && rec.annotation.capabilities ? rec.annotation.capabilities : null;
      const emoOk = caps && caps.emotion && caps.emotion.status === 'ok';
      const li = document.createElement('li');
      addText(li, emoOk ? '本轮未提供情绪/声音观察项（能力可用，详见下方能力状态）。' : '无声音/情绪观察（详见下方能力状态）。');
      el.observations.appendChild(li); return;
    }
    obs.forEach((o) => {
      const li = document.createElement('li');
      const bits = [o.label, '类型：' + o.kind, timingText(o.timing), '来源：' + provText(o.source_provider, o.source_model)];
      if (o.score && typeof o.score.value === 'number') bits.push('分数：' + o.score.value + '（含义：' + (o.score.semantics || '未标注') + '）');
      addText(li, bits.join('；')); el.observations.appendChild(li);
    });
  }
  function renderCapabilities(rec) {
    clearChildren(el.capabilities);
    const caps = rec.annotation && rec.annotation.capabilities ? rec.annotation.capabilities : null;
    const dims = [['word_timing', '字词时间'], ['emotion', '情绪'], ['prosody', '韵律'], ['sound_event', '声音事件']];
    if (!caps) { dims.forEach((d) => { const li = document.createElement('li'); addText(li, d[1] + '：不可用（缺少结果）。'); el.capabilities.appendChild(li); }); return; }
    dims.forEach((d) => {
      const c = caps[d[0]]; const li = document.createElement('li');
      if (c && c.status === 'ok') addText(li, d[1] + '：可用（来源：' + provText(c.source_provider, c.source_model) + '）');
      else if (c) addText(li, d[1] + '：' + (c.status === 'failed' ? '失败' : '不可用') + '（' + (c.reason || '未说明') + '）');
      else addText(li, d[1] + '：不可用（未提供）。');
      el.capabilities.appendChild(li);
    });
  }
  function renderReply(rec) {
    const hasDraft = !!rec.reply_draft, hasPlan = !!rec.reply_plan, hasOut = !!rec.output_asset;
    if (!hasDraft && !hasPlan && !hasOut) { el.replySection.hidden = true; return; }
    el.replySection.hidden = false;
    el.replyText.textContent = hasDraft ? rec.reply_draft.reply_text : '回复文本不可用。';
    clearChildren(el.replyPlan);
    const segs = (hasPlan ? rec.reply_plan.segments : (hasDraft ? rec.reply_draft.segments : [])) || [];
    const note = document.createElement('li'); addText(note, '以下为预期表达计划，非实际音频测量时间。'); el.replyPlan.appendChild(note);
    segs.forEach((s) => {
      const li = document.createElement('li');
      const pace = s.pace == null ? '未指定' : String(s.pace);
      const pause = s.pause_after_ms == null ? '未指定' : (s.pause_after_ms + 'ms');
      addText(li, s.text + '｜语气：' + s.tone + '｜强度：' + s.emotion_intensity + '｜语速：' + pace + '｜计划停顿：' + pause);
      el.replyPlan.appendChild(li);
    });
    if (hasOut && currentJobId && rec.output_asset.asset_id) {
      el.assistantAudio.src = '/api/jobs/' + encodeURIComponent(currentJobId) + '/audio/' + encodeURIComponent(rec.output_asset.asset_id);
      let label = '回复音频：';
      label += (health && health.mode === 'development-mock') ? '开发模式约 1 秒静音占位，不代表真实语音。' : rec.output_asset.media_type;
      el.playbackStatus.textContent = label;
    } else {
      el.assistantAudio.removeAttribute('src');
      el.playbackStatus.textContent = '回复音频不可用（未取得实际输出）。';
    }
    if (rec.output_alignment && Array.isArray(rec.output_alignment.units)) {
      el.outputTiming.textContent = '实际输出时间对齐：' + rec.output_alignment.units.length + ' 个单元，来源：' + rec.output_alignment.source + '。';
    } else {
      el.outputTiming.textContent = '实际输出时间对齐不可用（未取得，不伪造）。';
    }
  }
  function stopPreviewTimers() {
    if (previewMetaTimer) { clearTimeout(previewMetaTimer); previewMetaTimer = null; }
    if (previewFallbackTimer) { clearTimeout(previewFallbackTimer); previewFallbackTimer = null; }
  }
  function detachPreview() {
    if (previewLoadedHandler) { el.originalAudio.removeEventListener('loadedmetadata', previewLoadedHandler); previewLoadedHandler = null; }
    el.originalAudio.removeEventListener('timeupdate', onPreviewTime);
    el.originalAudio.removeEventListener('pause', onPreviewEnd);
    el.originalAudio.removeEventListener('ended', onPreviewEnd);
    el.originalAudio.removeEventListener('error', onPreviewEnd);
    stopPreviewTimers();
    previewEndSec = 0;
  }
  function onPreviewTime() { if (previewEndSec > 0 && el.originalAudio.currentTime >= previewEndSec) pausePreview(); }
  function onPreviewEnd() { detachPreview(); }
  function pausePreview() { previewSerial++; try { el.originalAudio.pause(); } catch (e) {} detachPreview(); }
  function playPreview(u) {
    const t = u.timing;
    if (!t || t.status !== 'available') { setStatus('该单元时间不可用，无法试听。'); return; }
    pauseAssistant();
    try { el.originalAudio.pause(); } catch (e) {}
    detachPreview();
    const serial = ++previewSerial;
    const start = t.start_ms / 1000;
    const end = t.end_ms / 1000;
    const doSeek = () => {
      if (serial !== previewSerial) return;
      detachPreview();
      if (serial !== previewSerial) return;
      previewEndSec = end;
      try {
        el.originalAudio.currentTime = start;
        el.originalAudio.addEventListener('timeupdate', onPreviewTime);
        el.originalAudio.addEventListener('pause', onPreviewEnd);
        el.originalAudio.addEventListener('ended', onPreviewEnd);
        el.originalAudio.addEventListener('error', onPreviewEnd);
        const armFallback = () => {
          if (serial !== previewSerial) return;
          const remaining = Math.max(0, previewEndSec - el.originalAudio.currentTime);
          previewFallbackTimer = setTimeout(() => { if (serial === previewSerial) pausePreview(); }, remaining * 1000 + 100);
        };
        const pr = el.originalAudio.play();
        if (pr && pr.then) pr.then(armFallback, () => { if (serial === previewSerial) { detachPreview(); setStatus('试听播放失败，可手动播放原始音频。'); applyControls(); } });
        else armFallback();
      } catch (e) { if (serial === previewSerial) { detachPreview(); setStatus('无法定位到该单元区间。'); applyControls(); } }
    };
    if (el.originalAudio.readyState >= 1) doSeek();
    else {
      previewLoadedHandler = doSeek;
      el.originalAudio.addEventListener('loadedmetadata', doSeek, { once: true });
      previewMetaTimer = setTimeout(() => { if (serial === previewSerial) { detachPreview(); setStatus('原始音频加载超时，无法试听。'); applyControls(); } }, PREVIEW_META_MS);
    }
  }
  function pauseAssistant() { if (!el.assistantAudio.paused) { try { el.assistantAudio.pause(); } catch (e) {} } }
  function setupMediaListeners() {
    el.assistantAudio.addEventListener('play', () => {
      const validOutput = !!(lastRecord && lastRecord.output_asset && currentJobId);
      if ((state === 'idle' || state === 'playing-reply') && validOutput) { setState('playing-reply'); el.playbackStatus.textContent = '回复音频播放中…'; }
      else { try { el.assistantAudio.pause(); } catch (e) {} }
    });
    el.assistantAudio.addEventListener('pause', () => { if (state === 'playing-reply') { setState('idle'); setStatus('已暂停回复播放。'); } });
    el.assistantAudio.addEventListener('error', () => { if (state === 'playing-reply') { setState('idle'); el.playbackStatus.textContent = '回复音频无法播放（可重试或选择其他输出）。'; } });
    el.assistantAudio.addEventListener('ended', () => { onAssistantEnded(); });
  }
  async function onAssistantEnded() {
    const g = gen;
    const record = lastRecord;
    const turnId = lastTurnId, sid = sessionId, jobId = currentJobId;
    const outputAssetId = record && record.output_asset ? record.output_asset.asset_id : null;
    const mode = record ? record.mode : null;
    if (state === 'playing-reply') setState('idle');
    if (!record || !turnId || !sid || !jobId || !outputAssetId) { el.playbackStatus.textContent = '播放结束（无有效轮次标识，未提交确认）。'; return; }
    el.playbackStatus.textContent = '正在提交播放完成确认…';
    const url = '/api/sessions/' + encodeURIComponent(sid) + '/turns/' + encodeURIComponent(turnId) + '/playback-completed';
    let out;
    try { out = await requestJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, POLL_FETCH_TIMEOUT_MS); }
    catch (e) { if (fresh(g)) el.playbackStatus.textContent = '播放完成确认提交失败，可手动重播。'; return; }
    if (!fresh(g) || lastRecord !== record || lastTurnId !== turnId || sessionId !== sid || currentJobId !== jobId) return;
    const rec = out.data;
    const confirmed = !!(out.res.ok && rec && typeof rec === 'object'
      && rec.turn_id === turnId && rec.session_id === sid && rec.mode === mode
      && rec.playback_completed === true
      && rec.output_asset && rec.output_asset.asset_id === outputAssetId);
    if (confirmed) {
      el.playbackStatus.textContent = '播放完成已确认。';
      record.playback_completed = true;
    } else {
      el.playbackStatus.textContent = '播放完成确认失败（' + out.res.status + '），可手动重播。';
    }
  }
  function onExportClick() {
    if (!lastRecord) return;
    const json = JSON.stringify(lastRecord, null, 2);
    if (json.length > 2000000) { showError('记录过大，无法导出。'); return; }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'turn-' + (lastRecord.turn_id || 'record') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function resetDisplay() {
    clearChildren(el.tokenGrid); clearChildren(el.observations); clearChildren(el.capabilities); clearChildren(el.replyPlan);
    el.transcript.textContent = '转写文本由运行时填充。'; el.selection.textContent = '尚未选择单元。';
    el.unitCount.textContent = '—'; el.replySection.hidden = true; el.resultSection.hidden = true;
    el.outputTiming.textContent = '实际输出时间对齐状态由运行时显示；未取得时不伪造。';
    el.playbackStatus.textContent = '播放状态加载中。';
    pauseAssistant(); pausePreview();
    el.originalAudio.removeAttribute('src'); el.assistantAudio.removeAttribute('src');
    activeUnits = [];
  }
  function onClearClick() {
    if (state === 'requesting-microphone' || state === 'recording' || state === 'submitting' || state === 'processing') return;
    bump();
    clearRecTimers(); releaseMic(); mediaRecorder = null; recChunks = [];
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    pendingBlob = null; pendingRequestId = null; setRetry(null); currentJobId = null;
    lastRecord = null; lastTurnId = null; selectedFile = null;
    el.file.value = ''; el.time.textContent = '0';
    resetDisplay(); setState('idle'); hideError(); setStatus('等待提交音频。');
  }
  function onPageHide() {
    pageHidden = true; bump();
    clearRecTimers(); releaseMic(); mediaRecorder = null; recChunks = [];
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    pauseAssistant(); detachPreview();
  }
  function wire() {
    el.record.addEventListener('click', onRecordClick);
    el.stop.addEventListener('click', stopRecording);
    el.file.addEventListener('change', onFileChange);
    el.upload.addEventListener('click', onUploadClick);
    el.retry.addEventListener('click', onRetryClick);
    el.export.addEventListener('click', onExportClick);
    el.clear.addEventListener('click', onClearClick);
    window.addEventListener('pagehide', onPageHide);
    setupMediaListeners();
  }
  document.addEventListener('DOMContentLoaded', () => { wire(); init(); });
})();