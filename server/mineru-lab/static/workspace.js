const byId = id => document.getElementById(id);
const upload = byId('upload-form');
const editor = byId('template-form');
const templateWorkspace = byId('template-workspace');
const pageSelect = byId('page-number');
const workspace = byId('workspace');
const desk = workspace.parentElement;
const deskNav = document.querySelector('.desk-nav');
const deskViews = [...deskNav.querySelectorAll('[data-view]')];
const templateSelect = byId('selected-template');
const layoutMode = byId('layout-mode');
const questionLayout = byId('question-layout');
const correction = byId('correction');
const clearAfterDownload = byId('clear-after-download');
const fixedLayouts = { 'adaptive-rows': '原位自适应', 'page-paragraphs': '无文本框', 'merged-options': '选项合框', 'separate-options': '选项分框', 'page-images': '跨平台原位' };
const runList = byId('run-list');
const historySearch = byId('history-search');
const correctionRole = byId('correction-role');
const correctionAlignment = byId('correction-alignment');
const exportDialog = byId('document-settings');
const selectionPanel = byId('selection-panel');
const styleSelect = byId('style-element');
const roleNames = { body: '正文', instructions: '注意事项', option: '选项', caption: '图表标题', header: '页眉', footer: '页脚', formula: '公式', table: '表格' };
const mixedLayouts = {
  'mixed-fixed': { mode: 'fixed', label: '按题原位', description: 'Pipeline 坐标与插图 · VLM 文字' },
  'mixed-flow': { mode: 'flow', label: '混合重排', description: 'VLM 文字转普通段落 · Pipeline 插图' },
};
for (let level = 1; level <= 9; level++) roleNames[`heading${level}`] = `${level} 级标题`;
const statusNames = { submitting: '提交中', uploading: '上传中', 'waiting-file': '等待文件', pending: '排队中', running: '处理中', converting: '转换中', done: '等待文件', downloading: '下载原包', ready: '已完成', failed: '失败', queued: '排队中' };
const state = { templates: [], elements: [], styleDefaults: null, run: '', runResults: [], source: null, page: null, selection: null, exportTimer: null, runTimer: null, pageRequest: 0, mixedLayouts: false };
let submittingExport;
let savingCorrection = false;
let downloading = false;
const editorState = { id: undefined, role: 'body', styles: {}, paperDefaults: {} };
const paperEdges = ['top', 'right', 'bottom', 'left'];
const paperSizes = { '16k': [185, 260], a4: [210, 297] };
const templatePreference = 'typesetting.selected-template';
const fontMenu = byId('font-menu');
let fontTarget;

for (const option of byId('font-options').options) {
  const label = option.getAttribute('label');
  const button = node('button', label ? `${label} · ${option.value}` : option.value, 'font-option');
  button.type = 'button';
  button.addEventListener('click', () => {
    fontTarget.value = option.value;
    fontTarget.dispatchEvent(new Event('input', { bubbles: true }));
    fontMenu.hidePopover();
    fontTarget.focus();
  });
  fontMenu.append(button);
}

for (const trigger of document.querySelectorAll('[data-font-target]')) {
  trigger.addEventListener('click', () => {
    fontTarget = byId(trigger.dataset.fontTarget);
    const bounds = trigger.getBoundingClientRect();
    const maxHeight = Math.min(280, innerHeight - 24);
    const menuWidth = Math.min(250, innerWidth - 24);
    fontMenu.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - menuWidth - 12))}px`;
    fontMenu.style.top = `${bounds.bottom + maxHeight + 8 < innerHeight ? bounds.bottom + 5 : Math.max(12, bounds.top - maxHeight - 5)}px`;
    fontMenu.showPopover();
    fontMenu.querySelector('button')?.focus();
  });
}


function node(tag, text, css) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (css) result.className = css;
  return result;
}

function notice(target, message = '', error = false) {
  byId(target).textContent = message;
  byId(target).classList.toggle('error', error);
}

function previewNotice(message = '', retry) {
  byId('preview-message').hidden = !message;
  byId('paper').hidden = Boolean(message);
  notice('preview-status', message, Boolean(retry));
  const button = byId('retry-preview');
  button.hidden = !retry;
  button.onclick = retry ?? null;
  byId('paper-scroll').scrollTop = 0;
}

function showMixSummary(page, mode) {
  const summary = byId('mix-summary');
  const stats = page?.mixed;
  summary.hidden = !stats;
  if (!stats) return;
  summary.textContent = mode === 'fixed'
    ? `${page.questionBlocks?.length ? `本页 ${page.questionBlocks.length} 个题干及选项框` : fixedLayouts[questionLayout.value]} · ${stats.pipelineImages} 张图保持原位`
    : `本页 ${stats.pipelineImages} 张图使用 Pipeline 尺寸${stats.unmatchedImages ? ` · ${stats.unmatchedImages} 张图仅有 VLM 尺寸，请对照原卷` : ''}`;
}

async function api(url, method = 'GET', data, signal) {
  const form = data instanceof FormData;
  const headers = method === 'GET' ? {} : { 'X-MinerU-Lab': '1', ...(form || data === undefined ? {} : { 'Content-Type': 'application/json' }) };
  const response = await fetch(url, { method, headers, signal, body: form ? data : data === undefined ? undefined : JSON.stringify(data) });
  if (response.status === 204) return;
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw Object.assign(new Error(response.status === 404 ? '任务已清除、到期或不存在。' : `请求失败（${response.status}）`), { status: response.status });
  }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || `请求失败（${response.status}）`), { status: response.status });
  return result;
}

async function previewData(url, method = 'GET', data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    return await api(url, method, data, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('服务响应超时，请重试。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function link(text, href) {
  const anchor = node('a', text);
  anchor.href = href;
  return anchor;
}

function sourcePath(id, file, model) {
  return `/api/runs/${id}/${file}/${model}`;
}

function showDeskView(view) {
  if (view === 'templates' && templateWorkspace.hidden) {
    if (!state.templates.length) return;
    if (editorState.id === undefined) showTemplate(templateSelect.value || state.templates[0].id);
    else { refreshStyleOptions(); previewTemplate(); }
  }
  if (view !== 'templates' && fontMenu.matches(':popover-open')) fontMenu.hidePopover();
  templateWorkspace.hidden = view !== 'templates';
  desk.hidden = view === 'templates';
  byId('open-export').hidden = view !== 'proof' || !state.source;
  desk.dataset.view = view;
  for (const button of deskViews) button.setAttribute('aria-pressed', String(button.dataset.view === view));
}

for (const button of deskViews) button.addEventListener('click', async () => {
  if (await saveDraft()) showDeskView(button.dataset.view);
});
byId('open-export').addEventListener('click', () => exportDialog.showModal());
byId('close-export').addEventListener('click', () => exportDialog.close());

function updateAddress() {
  const query = new URLSearchParams();
  if (state.run) query.set('run', state.run);
  if (state.file) query.set('file', state.file);
  if (state.source) {
    query.set('model', state.source.model);
  }
  history.replaceState(null, '', query.size ? `?${query}` : location.pathname);
}

async function refreshHistory() {
  const records = await api('/api/runs');
  state.history = records;
  renderHistory();
  return records;
}

function renderHistory() {
  const query = historySearch.value.trim().toLowerCase();
  const cards = (state.history ?? []).flatMap(run => {
    const results = run.id === state.run && state.runResults.length ? state.runResults : run.results;
    const date = run.createdAt ? new Date(run.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const files = new Map(results.map(item => [item.fileId, item.name]));
    return [...files].filter(([, name]) => name.toLowerCase().includes(query)).map(([id, name]) => {
      const button = node('button', undefined, 'history-item quiet');
      button.type = 'button';
      button.title = name;
      button.setAttribute('aria-pressed', String(run.id === state.run && id === state.file));
      const variants = results.filter(item => item.fileId === id);
      const ready = variants.filter(item => item.state === 'ready').length;
      button.append(node('strong', name), node('small', [date, `${ready}/${variants.length} 已完成`].filter(Boolean).join(' · ')));
      button.addEventListener('click', () => selectRun(run.id, { fileId: id }));
      return button;
    });
  });
  runList.replaceChildren(...(cards.length ? cards : [node('p', query ? '没有匹配的文件。' : '暂无识别记录。', 'muted')]));
}

async function refreshRun(id, wanted) {
  try {
    const run = await api(`/api/runs/${id}`);
    if (id !== state.run) return;
    state.runResults = run.results;
    clearTimeout(state.expiryTimer);
    if (run.expiresAt) {
      state.expiryTimer = setTimeout(() => {
        if (state.run === id) forgetRun(id, '任务已到期。');
      }, Math.max(0, run.expiresAt - Date.now()));
    }
    byId('clear-run').hidden = false;
    byId('clear-run').disabled = run.results.some(item => !['ready', 'failed'].includes(item.state));
    state.file ||= run.results[0]?.fileId;
    renderHistory();
    let working = false;
    let matching;
    const fileResults = run.results.filter(item => item.fileId === state.file);
    const records = fileResults.map(item => {
      const row = node('div', undefined, 'result');
      const head = node('div', undefined, 'result-head');
      const elapsed = item.parsedAt && item.uploadedAt ? ` · ${((item.parsedAt - item.uploadedAt) / 1000).toFixed(1)}s` : '';
      head.append(node('strong', item.model === 'pipeline' ? 'Pipeline' : 'VLM'));
      row.append(head);
      if (item.state === 'ready') {
        const actions = node('div', undefined, 'result-links');
        const open = node('button', state.source?.model === item.model ? '当前工作区' : '打开排版', 'quiet');
        open.type = 'button';
        open.addEventListener('click', () => openWorkspace(item));
        actions.append(open, node('span', elapsed.replace(' · ', ''), 'muted'));
        row.append(actions);
        if (wanted?.fileId === item.fileId && wanted.model === item.model) matching = item;
      } else {
        working ||= item.state !== 'failed';
        const pages = item.progress?.total_pages ? ` · ${item.progress.extracted_pages ?? 0}/${item.progress.total_pages} 页` : '';
        const attempt = item.state === 'downloading' && item.downloadAttempt ? ` · 第 ${item.downloadAttempt}/4 次` : '';
        row.append(node('p', item.error ?? `${statusNames[item.state] || item.state}${pages}${attempt}`, item.error ? 'error' : 'muted'));
        if (item.state !== 'failed') {
          const progress = node('progress', undefined, 'progress');
          progress.setAttribute('aria-label', `${item.model === 'pipeline' ? 'Pipeline' : 'VLM'} 识别进度`);
          if (item.state !== 'downloading' && item.progress?.total_pages > 0 && (item.progress.extracted_pages ?? 0) < item.progress.total_pages) {
            progress.max = item.progress.total_pages;
            progress.value = item.progress.extracted_pages ?? 0;
          }
          row.append(progress);
        }
        if (item.retryAction) {
          const retry = node('button', item.retryAction === 'download' ? '重试下载' : '重新识别此结果', 'quiet');
          retry.type = 'button';
          if (item.retryAction === 'recognize') retry.title = '旧记录没有批次号，将用本地原 PDF 重新提交这个模型';
          retry.disabled = run.results.some(result => !['failed', 'ready'].includes(result.state));
          retry.addEventListener('click', async () => {
            retry.disabled = true;
            try {
              await api(`${sourcePath(id, item.fileId, item.model)}/retry`, 'POST', { action: item.retryAction });
              if (id !== state.run) return;
              clearTimeout(state.runTimer);
              notice('upload-status');
              await refreshRun(id, wanted);
            } catch (error) {
              if (id === state.run) notice('upload-status', error.message, true);
              retry.disabled = false;
            }
          });
          row.append(retry);
        }
      }
      return row;
    });
    const mixedRecords = fileResults.filter(item => item.state === 'ready' && item.model === 'pipeline'
      && fileResults.some(other => other.model === 'vlm' && other.state === 'ready'))
      .map(item => {
        const row = node('div', undefined, 'result');
        const actions = node('div', undefined, 'result-links');
        for (const [model, { label, description }] of Object.entries(mixedLayouts)) {
          const result = { ...item, model };
          const open = node('button', label, 'quiet');
          open.type = 'button';
          open.title = description;
          open.addEventListener('click', () => openWorkspace(result));
          actions.append(open);
          if (wanted?.fileId === item.fileId && wanted.model === model) matching = result;
        }
        row.append(node('strong', '混合排版'), actions);
        return row;
      });
    byId('run-results').replaceChildren(...mixedRecords, ...records);
    if (state.source?.info) updateTemplateAvailability(templateSelect.value);
    const expires = run.expiresAt && new Date(run.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (expires) byId('run-results').append(node('p', `本站任务文件于 ${expires} 到期。`, 'muted'));
    if (!state.source && matching) void openWorkspace(matching);
    if (working || run.results.some(item => !['ready', 'failed'].includes(item.state))) state.runTimer = setTimeout(() => refreshRun(id, wanted), 2300);
  } catch (error) {
    if (id !== state.run) return;
    if (error.status === 404) forgetRun(id, error.message);
    else {
      notice('upload-status', error.message, true);
      state.runTimer = setTimeout(() => refreshRun(id, wanted), 3000);
    }
  }
}

function selectRun(id, wanted) {
  clearTimeout(state.runTimer);
  clearTimeout(state.expiryTimer);
  clearTimeout(state.exportTimer);
  state.run = id;
  state.file = wanted?.fileId;
  state.runResults = [];
  state.source = null;
  state.page = null;
  workspace.hidden = true;
  deskViews.find(button => button.dataset.view === 'proof').disabled = true;
  showDeskView('library');
  updateAddress();
  renderHistory();
  byId('run-results').replaceChildren();
  byId('deselect-run').hidden = !id;
  byId('clear-run').hidden = true;
  if (id) void refreshRun(id, wanted);
}

function forgetRun(id, message) {
  state.history = (state.history ?? []).filter(run => run.id !== id);
  if (state.run === id) {
    exportDialog.close();
    selectRun('');
    notice('upload-status', message);
  } else renderHistory();
}

async function clearRun(id) {
  await api(`/api/runs/${id}`, 'DELETE');
  forgetRun(id, '服务器上的整批任务文件已清除。');
}

byId('deselect-run').addEventListener('click', () => selectRun(''));
byId('clear-run').addEventListener('click', async () => {
  if (!state.run || !confirm('清除本批所有 PDF、识别结果、校对记录和 Word 导出？')) return;
  const id = state.run;
  byId('clear-run').disabled = true;
  try { await clearRun(id); }
  catch (error) {
    if (state.run === id) {
      notice('upload-status', error.message, true);
      byId('clear-run').disabled = false;
    }
  }
});

async function openWorkspace(result) {
  const source = { ...result, runId: state.run, base: sourcePath(state.run, result.fileId, result.model) };
  if (state.source?.base === source.base && state.page) { showDeskView('proof'); return; }
  clearTimeout(state.exportTimer);
  state.source = source;
  state.file = result.fileId;
  state.page = null;
  workspace.hidden = false;
  deskViews.find(button => button.dataset.view === 'proof').disabled = false;
  showDeskView('proof');
  byId('workspace-name').textContent = source.name;
  const mixed = mixedLayouts[source.model];
  byId('export-formula-mode').value = '';
  questionLayout.value = localStorage.getItem(`${source.base}:variant`) || 'adaptive-rows';
  if (!questionLayout.value) questionLayout.value = 'adaptive-rows';
  byId('source-model').textContent = mixed ? `${mixed.label} · ${mixed.description}` : source.model;
  byId('source-link').hidden = true;
  pageSelect.replaceChildren();
  for (const id of ['page-number', 'previous-page', 'next-page', 'edit-template']) byId(id).disabled = true;
  byId('paper').replaceChildren();
  byId('export-list').replaceChildren();
  notice('export-status');
  const downloadSources = mixed ? ['pipeline', 'vlm'] : [source.model];
  byId('source-downloads').replaceChildren(...downloadSources.flatMap(model => {
    const base = sourcePath(state.run, source.fileId, model);
    const label = mixed ? `${model === 'pipeline' ? 'Pipeline' : 'VLM'} ` : '';
    return [link(`${label}原始 ZIP`, `${base}/zip`), link(`${label}MinerU Word`, `${base}/native-word`)];
  }));
  byId('generate-word').disabled = true;
  byId('layout-capability').hidden = true;
  byId('question-layout-field').hidden = true;
  byId('open-pipeline').hidden = true;
  setSelection(null);
  notice('workspace-status');
  showMixSummary();
  previewNotice('正在打开版面…');
  updateAddress();
  try {
    if (mixed && !state.mixedLayouts) {
      const config = await previewData('/api/config');
      if (source !== state.source) return;
      state.mixedLayouts = config.mixedLayouts === true;
      if (!state.mixedLayouts) throw new Error('当前后端未启用混合排版。请重启新版重排版服务并刷新网页。');
    }
    const info = await previewData(`${source.base}/pages`);
    if (source !== state.source) return;
    if (mixed && info.layoutMode !== mixed.mode) throw new Error('当前后端未返回混合版面。请重启新版重排版服务并刷新网页。');
    source.info = info;
    layoutMode.value = info.layoutMode ?? ((info.supportsFixed || info.sourcePdf) && localStorage.getItem(`${source.base}:mode`) === 'fixed' ? 'fixed' : 'flow');
    updateTemplateAvailability();
    if (!templateWorkspace.hidden) refreshStyleOptions();
    pageSelect.replaceChildren(...info.pages.map(page => new Option(`第 ${page} 页`, String(page))));
    byId('source-link').hidden = !info.sourcePdf;
    byId('source-link').textContent = info.sourcePdf === 'archive' ? '打开解析包 PDF ↗' : '打开原 PDF ↗';
    void refreshExports(source);
    if (info.pages.length) await openPage(info.pages[0]);
    else previewNotice('这条识别结果没有可预览的页面。');
  } catch (error) {
    if (source === state.source) {
      if (error.status === 404) forgetRun(state.run, error.message);
      else previewNotice(`无法打开版面：${error.message}`, () => openWorkspace(result));
    }
  }
}

function itemName(item) {
  return roleNames[item.roleOverride] || (item.level ? `${item.level} 级标题` : roleNames[item.role] || roleNames[item.kind] || '正文');
}

function setSelection(item) {
  state.selection = item;
  selectionPanel.hidden = !item;
  byId('selection-label').textContent = item ? `${itemName(item)} · 第 ${state.page.number} 页` : '点选预览中的文字或公式。';
  byId('correction-context').textContent = byId('selection-label').textContent;
  const textOnLine = item ? lineTextItems(state.page, item) : [];
  for (const [buttonId, role] of [['mark-stem', 'stem'], ['mark-option', 'option']]) {
    const button = byId(buttonId);
    button.hidden = !textOnLine.length;
    button.setAttribute('aria-pressed', String(textOnLine.length > 0 && textOnLine.every(part => part.role === role)));
  }
  notice('correction-status');
  correction.value = item?.text ?? '';
  byId('correction').disabled = !item;
  correctionRole.options[0].textContent = item && !item.roleOverride ? `自动识别 · ${itemName(item)}` : '恢复自动识别';
  correctionRole.value = item?.roleOverride ?? '';
  correctionRole.disabled = !item;
  byId('correction-alignment-field').hidden = state.page?.layoutMode !== 'flow';
  correctionAlignment.disabled = !item || state.page?.layoutMode !== 'flow';
  correctionAlignment.value = item?.alignmentOverride ?? '';
  byId('correction-group').disabled = !item;
  byId('correction-group').checked = false;
  updateDraftControls();
  for (const mark of byId('paper').querySelectorAll('[data-item]')) mark.classList.toggle('selected', mark.dataset.item === item?.id);
}

async function editItem(item) {
  const { source, page } = state;
  if (item !== state.selection) {
    if (!(await saveDraft()) || source !== state.source || page?.number !== state.page?.number) return;
    const selected = state.page.items.find(part => part.id === item.id);
    if (!selected) return;
    setSelection(selected);
  }
  toggleCorrection(true);
}

function lineTextItems(page, item) {
  return page.items.filter(part => (part.kind === 'text' || part.kind === 'formula') && part.group === item.group && part.line === item.line);
}

function renderPage(page, source) {
  const paper = byId('paper');
  const [width, height] = page.size;
  const template = state.templates.find(item => item.id === templateSelect.value);
  const formulaMode = byId('export-formula-mode').value || template?.formulaMode || 'editable';
  const flow = page.layoutMode === 'flow' || page.approximateLines;
  paper.classList.toggle('paper-flow', flow);
  if (flow) {
    paper.style.aspectRatio = '';
    const elements = [];
    let paragraph;
    let previous;
    for (const item of page.items) {
      if (['header', 'footer', 'page_number'].includes(item.role)) continue;
      if (item.asset && (item.kind === 'image' || item.kind === 'table')) {
        const image = node('img');
        image.src = `${source.base}/asset/${encodeURIComponent(item.asset)}`;
        image.alt = item.kind === 'table' ? '表格' : '配图';
        if (page.mixed) image.style.width = `${(item.box[2] - item.box[0]) / width * 100}%`;
        elements.push(image);
        paragraph = undefined;
        previous = undefined;
        continue;
      }
      const startsOption = item.kind === 'text' && item.role === 'option'
        && (previous?.role !== 'option' || /^[A-GＡ-Ｇ]\s*[.．、)）]/.test(item.text ?? ''));
      if (!paragraph || (previous?.group !== item.group && item.kind !== 'formula') || startsOption) {
        paragraph = node('p');
        const role = item.flowRole ?? (item.level ? `heading${item.level}` : item.role);
        paragraph.style.textAlign = item.alignmentOverride ?? template?.styles?.[role]?.alignment ?? (item.mainTitle ? 'center' : '');
        elements.push(paragraph);
      } else if (item.alignmentOverride) {
        paragraph.style.textAlign = item.alignmentOverride;
      }
      previous = item;
      const run = node('span', item.text, 'flow-proof-run');
      run.tabIndex = 0;
      run.setAttribute('role', 'button');
      run.dataset.item = item.id;
      if (item.level) run.style.fontWeight = '700';
      if (item.kind === 'formula' && item.text) {
        if (formulaMode === 'latex') run.textContent = `$${item.text}$`;
        else if (window.katex) window.katex.render(item.text, run, { throwOnError: false, trust: false });
      }
      run.addEventListener('click', () => editItem(item));
      run.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void editItem(item);
      });
      paragraph.append(run);
    }
    paper.replaceChildren(...elements);
    setSelection(null);
    return;
  }
  paper.style.aspectRatio = `${width} / ${height}`;
  const elements = page.items.map(item => {
    const [x, y, right, bottom] = item.box;
    const editable = item.kind === 'text' || item.kind === 'formula';
    const mark = node(editable ? 'button' : 'div', undefined, editable ? 'mark bounded-preview' : 'mark figure');
    Object.assign(mark.style, { left: `${x / width * 100}%`, top: `${y / height * 100}%`, width: `${(right - x) / width * 100}%`,
      height: `${(bottom - y) / height * 100}%`, fontSize: `${Math.min((bottom - y) / width * 91, 4.3)}cqw` });
    if (item.kind === 'text' && !item.level && ['text', 'list', 'body', 'stem', 'option'].includes(item.role)) {
      const own = template?.styles?.[item.role];
      const style = { ...(own?.inheritBody === false ? {} : template?.styles?.body), ...own };
      const size = style.fontSizePt ?? state.styleDefaults.fixedBodyFontSizePt ?? 11;
      const mm = template?.widthMm ?? 210;
      mark.dataset.uniformText = '';
      mark.style.fontSize = `${size * 25.4 / 72 / mm * 100}cqw`;
      mark.style.fontFamily = `"${(style.font ?? template?.font ?? 'SimSun').replace(/["\\]/g, '')}", serif`;
      if (style.bold) mark.style.fontWeight = '700';
      if (style.underline) mark.style.textDecoration = 'underline';
      if (style.color) mark.style.color = style.color;
    }
    if (editable) {
      mark.type = 'button';
      mark.dataset.item = item.id;
      mark.title = `${itemName(item)} · ${item.text ?? ''}`;
      const content = node('span', item.text, 'bounded-content');
      mark.addEventListener('click', () => editItem(item));
      if (item.crop && formulaMode !== 'latex' && (questionLayout.value !== 'adaptive-rows' || formulaMode === 'image')) {
        const crop = node('img');
        crop.src = `data:image/png;base64,${item.crop}`;
        crop.alt = '原卷局部';
        content.replaceChildren(crop);
      } else if (item.kind === 'formula' && item.text) {
        if (formulaMode === 'latex') content.textContent = `$${item.text}$`;
        else if (window.katex) window.katex.render(item.text, content, { throwOnError: false, trust: false });
      }
      if (item.level) mark.style.fontWeight = '700';
      mark.append(content);
    } else if (item.crop || item.asset) {
      const image = node('img');
      image.src = item.crop ? `data:image/png;base64,${item.crop}` : `${source.base}/asset/${encodeURIComponent(item.asset)}`;
      image.alt = item.kind === 'table' ? '表格' : '配图';
      mark.append(image);
    } else if (item.kind === 'table') mark.textContent = '表格';
    return mark;
  });
  paper.replaceChildren(...elements);
  for (const block of page.questionBlocks ?? []) {
    const [left, top, right, bottom] = block.box;
    const outline = node('div', undefined, 'question-outline');
    outline.setAttribute('aria-hidden', 'true');
    Object.assign(outline.style, { left: `${left / width * 100}%`, top: `${top / height * 100}%`,
      width: `${(right - left) / width * 100}%`, height: `${(bottom - top) / height * 100}%` });
    paper.append(outline);
  }
  for (const { box } of page.rules ?? []) window.placePreviewRule(paper, box, width, height);
  window.watchPreviewBounds(paper);
  setSelection(null);
}

async function openPage(number) {
  const source = state.source;
  const request = ++state.pageRequest;
  state.page = null;
  setSelection(null);
  byId('edit-template').disabled = true;
  showMixSummary();
  previewNotice(`正在加载第 ${number} 页…`);
  try {
    const query = new URLSearchParams({ mode: layoutMode.value });
    if (layoutMode.value === 'fixed') query.set('questionLayout', questionLayout.value);
    const page = await previewData(`${source.base}/pages/${number}?${query}`);
    if (source !== state.source || request !== state.pageRequest) return;
    page.layoutMode = query.get('mode');
    state.page = page;
    pageSelect.value = number;
    pageSelect.disabled = false;
    byId('source-link').href = `${source.base}/source-pdf#page=${number}`;
    byId('previous-page').disabled = pageSelect.selectedIndex <= 0;
    byId('next-page').disabled = pageSelect.selectedIndex >= pageSelect.options.length - 1;
    renderPage(page, source);
    showMixSummary(page, source.info.layoutMode);
    byId('edit-template').disabled = false;
    previewNotice(page.items.length ? '' : '这一页没有识别到可预览的内容。');
    if (!templateWorkspace.hidden) previewTemplate();
    notice('workspace-status');
  } catch (error) {
    if (source === state.source && request === state.pageRequest) {
      state.page = null;
      if (error.status === 404 && state.expiryTimer) {
        void refreshRun(state.run);
      }
      previewNotice(`第 ${number} 页加载失败：${error.message}`, () => openPage(number));
    }
  }
}

async function refreshExports(source) {
  try {
    const jobs = await api(`${source.base}/exports`);
    if (source !== state.source) return;
    byId('download-options').hidden = !jobs.some(job => job.state === 'ready');
    byId('export-list').replaceChildren(...jobs.map(job => {
      const row = node('div', undefined, 'result export-result');
      const variant = fixedLayouts[job.questionLayout];
      const date = new Date(job.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      row.append(node('strong', [job.template.name, variant].filter(Boolean).join(' · ')), node('p', date, 'muted'));
      if (job.state !== 'ready') row.append(node('p', job.error ?? statusNames[job.state], job.error ? 'error' : 'muted'));
      if (job.state === 'ready') {
        const download = node('button', '下载整卷 Word', 'download-button');
        download.type = 'button';
        download.addEventListener('click', () => downloadWord(source, job));
        row.append(download);
        if (job.report) row.append(node('p', `原卷 ${job.report.pages} 页 · ${job.report.formulas} 个原生公式 · ${job.report.formulaImages ?? 0} 个公式图片`, 'muted'));
        if (job.report?.warnings.length) {
          const details = node('details');
          details.append(node('summary', '导出提示'), ...job.report.warnings.map(warning => node('p', `第 ${warning.page} 页：${warning.message}`, 'muted')));
          row.append(details);
        }
      }
      return row;
    }), ...(!jobs.length ? [node('p', '生成的整卷 Word 会显示在这里。', 'muted')] : []));
    if (jobs.some(job => job.state === 'running' || job.state === 'queued')) state.exportTimer = setTimeout(() => refreshExports(source), 1000);
  } catch (error) { if (source === state.source) notice('export-status', error.message, true); }
}

async function downloadWord(source, job) {
  if (downloading || !(await saveDraft()) || state.source !== source || downloading) return;
  downloading = true;
  const clear = clearAfterDownload.checked;
  try {
    const path = `/api/exports/${job.id}/download`;
    if (!clear) {
      link('', path).click();
      return;
    }
    if (!confirm('收到 Word 后清除本批所有任务文件？')) return;
    const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(130_000) });
    if (!response.ok) throw new Error('此 Word 已不可下载。');
    const blob = await response.blob();
    const length = Number(response.headers.get('content-length'));
    if (!length || blob.size !== length) throw new Error('下载中断，请重试。');
    const url = URL.createObjectURL(blob);
    const download = link('', url);
    download.download = job.filename;
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    try { await clearRun(source.runId); }
    catch { throw new Error('Word 已收到，任务清除未确认。可返回试卷页重试清除。'); }
  } catch (error) {
    if (source === state.source) notice('export-status', error.message, true);
  } finally { downloading = false; }
}

async function loadTemplates(selected) {
  const [templates, elements, defaults] = await Promise.all([api('/api/templates'), api('/api/template-elements'), api('/api/template-style-defaults')]);
  state.templates = templates;
  state.elements = elements;
  state.styleDefaults = defaults;
  for (const { id, label } of elements) roleNames[id] = label;
  correctionRole.replaceChildren(new Option('自动识别', ''), ...elements.filter(({ id }) => id !== 'table').map(({ id, label }) => new Option(label, id)));
  correctionRole.value = state.selection?.roleOverride ?? '';
  const current = selected ?? (templateSelect.value || localStorage.getItem(templatePreference));
  const options = () => state.templates.map(template => new Option(
    template.default ? `${template.name}（默认）` : template.name, template.id));
  templateSelect.replaceChildren(...options());
  byId('edit-template-id').replaceChildren(new Option('新建模板', ''), ...options());
  if (state.templates.some(template => template.id === current)) templateSelect.value = current;
  updateTemplateAvailability(current);
  byId('manage-templates').disabled = !state.templates.length;
}

function updateTemplateAvailability(preferred = localStorage.getItem(`${state.source?.base}:template`) || localStorage.getItem(templatePreference)) {
  const info = state.source?.info;
  const restricted = info?.supportsFixed === false;
  const compatible = Boolean(info?.sourcePdf);
  layoutMode.disabled = !info || (restricted && !compatible) || Boolean(info.layoutMode);
  for (const option of questionLayout.options) {
    option.disabled = option.value === 'page-images' ? !compatible : restricted;
  }
  if (questionLayout.selectedOptions[0]?.disabled) questionLayout.value = restricted && compatible ? 'page-images' : 'adaptive-rows';
  const mode = layoutMode.value;
  const portable = mode === 'fixed' && questionLayout.value === 'page-images';
  byId('export-formula-field').hidden = portable;
  const defaultId = state.templates.find(template => template.default)?.id;
  templateSelect.value = state.templates.some(template => template.id === preferred) ? preferred : defaultId ?? '';
  const template = state.templates.find(item => item.id === templateSelect.value);
  byId('use-default-template').hidden = !defaultId || template?.id === defaultId;
  const formula = { editable: 'Word 原生公式', image: '公式图片', latex: '保留 LaTeX' };
  byId('template-settings-summary').textContent = portable ? '保留原卷纸张与页脚' : template ? [template.font, formula[template.formulaMode ?? 'editable']].join(' · ') : '';
  updateGenerateButton();
  byId('question-layout-field').hidden = mode !== 'fixed';
  const hint = byId('layout-capability');
  hint.hidden = !restricted && !portable;
  hint.textContent = portable ? '每页嵌入原卷图片，适合在 WPS、微信和 QQ 中查看。此版文字不可编辑。'
    : compatible ? '此结果缺少逐行坐标，可按模板重排或逐页保留原卷。' : '此结果缺少逐行坐标，可按模板重排。';
  byId('open-pipeline').hidden = !restricted || !matchingPipeline();
}

function matchingPipeline() {
  return state.runResults.find(result => result.model === 'pipeline' && result.state === 'ready' && result.fileId === state.source?.fileId);
}

byId('open-pipeline').addEventListener('click', () => {
  const result = matchingPipeline();
  if (result) void openWorkspace(result);
});

const editorField = name => editor.elements.namedItem(name);
const paneButtons = [...editor.querySelectorAll('button[data-pane]')];
const panes = [...editor.querySelectorAll('.editor-pane')];
const editorBody = editor.querySelector('.editor-body');
const narrowEditor = matchMedia('(max-width: 800px)');
let settingsPane = 'typography';

function showPane(name) {
  if (name === 'preview' && !narrowEditor.matches) name = settingsPane;
  if (name !== 'preview') settingsPane = name;
  editorBody.dataset.pane = name;
  for (const pane of panes) pane.hidden = pane.id !== `pane-${settingsPane}`;
  for (const button of paneButtons) button.setAttribute('aria-pressed', String(button.dataset.pane === name));
  editor.querySelector('.editor-fields').scrollTop = 0;
}

for (const button of paneButtons) button.addEventListener('click', () => showPane(button.dataset.pane));
narrowEditor.addEventListener('change', () => {
  if (!narrowEditor.matches && editorBody.dataset.pane === 'preview') showPane(settingsPane);
});

const numericControls = new Map();

function setNumber(field, value) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function stepNumber(field, direction) {
  const { baseline, increment } = numericControls.get(field);
  const current = field.valueAsNumber;
  const start = Number.isFinite(current) ? current : baseline;
  const next = Math.min(Number(field.max), Math.max(Number(field.min), Number((start + increment * direction).toFixed(5))));
  if (next !== start || field.validity.badInput) setNumber(field, next);
}

for (const field of editor.querySelectorAll('input[type=number]')) {
  const label = field.parentElement;
  const title = label.firstChild.textContent.trim();
  const hint = label.querySelector('small');
  const wrapper = node('div', undefined, 'number-field');
  const group = node('div', undefined, 'number-control');
  const buttons = node('div', undefined, 'number-controls');
  const caption = node('label', title);
  field.id = `template-${field.dataset.style || field.name}`;
  caption.htmlFor = field.id;
  if (hint) {
    hint.id = `${field.id}-hint`;
    field.setAttribute('aria-describedby', hint.id);
  }
  const increment = Number(field.step);
  // Presets and imported values can use a different precision from the step buttons.
  field.step = 'any';
  label.replaceWith(wrapper);
  wrapper.append(caption, group);
  if (hint) wrapper.append(hint);
  group.append(field, buttons);
  const minus = node('button', '−', 'quiet');
  const plus = node('button', '+', 'quiet');
  const reset = node('button', '↺', 'quiet');
  for (const [button, action] of [[minus, `减小${title}`], [plus, `增大${title}`], [reset, `恢复${title}默认值`]]) {
    button.type = 'button';
    button.title = action;
    button.setAttribute('aria-label', action);
  }
  minus.addEventListener('click', () => stepNumber(field, -1));
  plus.addEventListener('click', () => stepNumber(field, 1));
  reset.addEventListener('click', () => { setNumber(field, ''); field.focus(); });
  buttons.append(minus, plus, reset);
  numericControls.set(field, { group, increment, reset, baseline: 0 });
  field.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    stepNumber(field, event.key === 'ArrowUp' ? 1 : -1);
  });
}

function updateNumericControl(field) {
  const control = numericControls.get(field);
  const inherits = field.value === '' && !field.validity.badInput;
  control.group.toggleAttribute('data-inherited', inherits);
  control.reset.disabled = inherits;
}

function refreshStyleOptions() {
  const detected = state.source?.info?.headingLevels;
  const levels = new Set(detected ?? [1, 2]);
  const showAll = byId('show-all-headings').checked;
  const options = state.elements.filter(({ id }) => {
    if (!id.startsWith('heading')) return true;
    return showAll || levels.has(Number(id.slice(7))) || Object.keys(editorState.styles[id] ?? {}).length > 0;
  });
  if (Array.from(styleSelect.options).map(option => option.value).join(',') !== options.map(({ id }) => id).join(',')) {
    styleSelect.replaceChildren(...options.map(({ id, label }) => new Option(label, id)));
  }
  if (options.some(({ id }) => id === editorState.role)) styleSelect.value = editorState.role;
  else showStyle('body');
  byId('heading-level-status').textContent = detected
    ? (detected.length ? `本卷识别到 ${detected.map(level => `${level} 级`).join('、')}标题。` : '本卷未识别到标题。')
    : '示例页包含 1、2 级标题。';
}
function readStyle() {
  const style = editorState.role !== 'body' && !byId('inherit-body').checked ? { inheritBody: false } : {};
  for (const field of editor.querySelectorAll('[data-style]')) {
    if (!field.validity.valid) {
      const previous = editorState.styles[editorState.role]?.[field.dataset.style];
      if (previous !== undefined) style[field.dataset.style] = previous;
      continue;
    }
    const value = field.value.trim();
    if (!value) continue;
    if (field.tagName === 'SELECT') style[field.dataset.style] = field.dataset.style === 'alignment' ? value : value === 'true';
    else style[field.dataset.style] = field.type === 'number' ? Number(value) : value;
  }
  editorState.styles[editorState.role] = style;
}
function showStyle(role) {
  editorState.role = role;
  styleSelect.value = role;
  byId('inherit-body-field').hidden = role === 'body';
  byId('inherit-body').checked = editorState.styles[role]?.inheritBody !== false;
  for (const field of editor.querySelectorAll('[data-style]')) field.value = editorState.styles[role]?.[field.dataset.style] ?? '';
}

function showInheritedStyles(template) {
  const role = editorState.role;
  const defaults = state.styleDefaults;
  const fixed = template.mode === 'fixed';
  const heading = role.startsWith('heading');
  const formulaImage = role === 'formula' && template.formulaMode === 'image';
  const nativeFormula = role === 'formula' && template.formulaMode === 'editable';
  const standardSize = defaults.flowFontSizePt[role === 'heading1' ? 'heading1' : heading ? 'heading' : role === 'footer' ? 'footer' : 'body'];
  const uniformBody = ['body', 'stem', 'option'].includes(role);
  const defaultSize = fixed && uniformBody ? defaults.fixedBodyFontSizePt ?? defaults.flowFontSizePt.body
    : fixed || role === 'table' || (role === 'formula' && template.formulaMode !== 'latex')
    ? '随识别框或公式'
    : role === 'footer' && !template.footer ? defaults.flowFontSizePt.body : standardSize;
  const fallback = {
    font: (nativeFormula || formulaImage) && template.font === 'SimSun' ? 'Cambria Math' : template.font,
    fontSizePt: role === 'footer' && template.footer ? defaults.flowFontSizePt.footer : defaultSize,
    color: defaults.color, bold: heading ? true : role === 'table' || nativeFormula || formulaImage ? undefined : false,
    underline: false, letterSpacingPt: defaults.letterSpacingPt, lineSpacing: `至少 ${defaults.minLineHeightRatio} × 字号`, firstLineIndentMm: defaults.firstLineIndentMm,
    spaceBeforePt: 0, spaceAfterPt: 0, leftIndentMm: 0, rightIndentMm: 0, alignment: 'left',
  };
  const style = template.styles[role] ?? {};
  const body = role === 'body' || style.inheritBody === false ? {} : template.styles.body ?? {};
  const labels = { bold: ['常规', '加粗'], underline: ['关闭', '开启'] };
  for (const field of editor.querySelectorAll('[data-style]')) {
    const key = field.dataset.style;
    const inherited = body[key] ?? fallback[key];
    const description = labels[key] ? labels[key][Number(inherited)] ?? '随内容' : inherited;
    const source = body[key] !== undefined ? '正文' : key === 'font' && inherited === template.font ? '模板' : '默认';
    if (field.tagName === 'SELECT') field.options[0].textContent = `继承 · ${key === 'alignment' ? [...field.options].find(option => option.value === description)?.textContent ?? '左对齐' : description}`;
    else {
      const value = String(description ?? '自动');
      const control = numericControls.get(field);
      if (control) {
        control.baseline = typeof inherited === 'number' ? inherited : key === 'fontSizePt' ? standardSize : defaults.minLineHeightRatio;
        updateNumericControl(field);
      }
      field.placeholder = control && typeof inherited !== 'number' ? '自动' : value;
      const stepHint = control && typeof inherited !== 'number' && key === 'fontSizePt' ? ` · 步进从 ${control.baseline} pt 起` : '';
      editor.querySelector(`[data-inherits="${key}"]`).textContent = `${source} · ${value}${stepHint}`;
    }
  }
  byId('style-color-picker').value = /^#[0-9a-f]{6}$/i.test(style.color ?? '') ? style.color : body.color ?? defaults.color;
  byId('style-context').textContent = formulaImage ? '公式图片使用渲染器自带字体。'
    : fixed && nativeFormula ? '原位公式会按识别框限制字号和行高。'
      : fixed && uniformBody ? '正文、题干和选项统一基准字号，狭窄行会压缩字宽。' : fixed ? '原位排版的文字会受识别框空间限制。' : '';
}
function templateDraft() {
  const field = name => editorField(name).value;
  const paperValue = name => {
    const input = editorField(name);
    return input.validity.valid && input.value !== '' ? input.valueAsNumber : editorState.paperDefaults[name];
  };
  return { name: field('name'), font: field('font'), mode: field('mode'), formulaMode: field('formulaMode'),
    widthMm: paperValue('widthMm'), heightMm: paperValue('heightMm') ?? null,
    margins: Object.fromEntries(paperEdges.map(edge => [edge, paperValue(edge)])),
    footer: byId('auto-footer').checked ? '{auto}' : field('footer'), footerDistanceMm: paperValue('footerDistanceMm'),
    markerWidth: field('markerWidth'), showPageMarks: editorField('showPageMarks').checked, styles: editorState.styles };
}

function previewTemplate() {
  const source = state.source;
  const page = state.page ?? undefined;
  const template = templateDraft();
  byId('custom-footer-field').hidden = byId('auto-footer').checked;
  const contentWidth = template.widthMm - (template.margins.left ?? 0) - (template.margins.right ?? 0);
  byId('paper-content-width').textContent = contentWidth > 0 ? `正文排版宽度 ${Number(contentWidth.toFixed(1))} mm` : '左右页边距必须给正文留出空间。';
  byId('paper-size').value = Object.keys(paperSizes).find(key => {
    const [width, height] = paperSizes[key];
    return width === template.widthMm && height === template.heightMm;
  }) ?? 'custom';
  const showFlow = page && source?.info?.supportsFixed === false && template.mode === 'fixed';
  byId('template-proof-caption').textContent = page ? `第 ${page.number} 页 · ${showFlow ? '缺少坐标，显示段落预览' : '样式预览'}` : '示例页 · 样式预览';
  showInheritedStyles(template);
  const autoHeight = Math.max(40, window.templateAutoHeight(template, page));
  numericControls.get(editorField('heightMm')).baseline = Number(autoHeight.toFixed(1));
  editorField('heightMm').placeholder = `自动 · ${autoHeight.toFixed(1)}`;
  window.renderTemplatePreview(byId('template-proof'), {
    template: showFlow ? { ...template, mode: 'flow' } : template, defaults: state.styleDefaults,
    page: page && template.mode === 'fixed' && questionLayout.value === 'adaptive-rows' && template.formulaMode === 'editable'
      ? { ...page, items: page.items.map(item => item.crop ? { ...item, crop: undefined } : item) } : page,
    assetPath: source ? asset => `${source.base}/asset/${encodeURIComponent(asset)}` : undefined, role: editorState.role,
    pageCount: source?.info?.pages.length, filename: source?.name.replace(/\.pdf$/i, ''),
    footerPattern: source?.info?.footerPattern ?? page?.footerPattern,
  });
}
function showTemplate(id, mode) {
  const template = id ? state.templates.find(item => item.id === id) : { ...state.templates[0], name: '', preset: false };
  if (!template) return;
  editorState.id = id;
  editorState.styles = structuredClone(template.styles ?? {});
  byId('show-all-headings').checked = false;
  byId('edit-template-id').value = id;
  const edges = template.margins ?? Object.fromEntries(paperEdges.map(edge => [edge, template.marginMm ?? 0]));
  editorState.paperDefaults = { widthMm: template.widthMm ?? 210, ...edges };
  byId('auto-footer').checked = template.footer === '{auto}';
  for (const [key, value] of Object.entries({ ...template, ...edges, mode: template.mode ?? 'fixed', formulaMode: template.formulaMode ?? 'editable',
    markerWidth: template.markerWidth ?? 'preserve', footer: template.footer === '{auto}' ? '' : template.footer ?? '', footerDistanceMm: template.footerDistanceMm ?? '' })) {
    const field = editorField(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  }
  if (mode) editorField('mode').value = mode;
  for (const [name, value] of Object.entries(editorState.paperDefaults)) {
    const field = editorField(name);
    field.value = '';
    field.placeholder = String(value);
    numericControls.get(field).baseline = value;
  }
  for (const field of numericControls.keys()) updateNumericControl(field);
  byId('template-subtitle').textContent = template.preset ? '预设模板 · 调整后可另存' : id ? '自定义模板' : '新建模板';
  byId('save-template').hidden = Boolean(template.preset);
  byId('save-template').textContent = id ? '保存修改' : '创建模板';
  byId('delete-template').hidden = !id || Boolean(template.preset);
  byId('copy-template').hidden = !id;
  byId('download-template').hidden = !id;
  if (id) byId('download-template').href = `/api/templates/${encodeURIComponent(id)}/download`;
  editorState.role = 'body';
  refreshStyleOptions();
  showStyle('body');
  showPane(id ? 'typography' : 'general');
  notice('template-status');
  previewTemplate();
}
function openEditor() {
  if (!state.templates.length) return;
  exportDialog.close();
  showTemplate(templateSelect.value || state.templates[0].id, state.source?.info ? layoutMode.value : undefined);
  showDeskView('templates');
  byId('manage-templates').focus();
}

upload.addEventListener('submit', async event => {
  event.preventDefault();
  const button = byId('upload-button');
  const progress = byId('upload-progress');
  button.disabled = true;
  progress.removeAttribute('value');
  progress.hidden = false;
  notice('upload-status', '正在上传…');
  try {
    const run = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', '/api/runs');
      request.setRequestHeader('X-MinerU-Lab', '1');
      request.responseType = 'json';
      request.upload.onprogress = event => {
        if (!event.lengthComputable) return;
        progress.max = event.total;
        progress.value = event.loaded;
        notice('upload-status', `正在上传 ${Math.round(event.loaded / event.total * 100)}%…`);
      };
      request.upload.onload = () => {
        progress.removeAttribute('value');
        notice('upload-status', '正在提交识别…');
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300 && request.response?.id) resolve(request.response);
        else reject(new Error(request.response?.error ?? `上传失败（${request.status}）`));
      };
      request.onerror = () => reject(new Error('上传连接中断，请重试。'));
      request.send(new FormData(upload));
    });
    clearAfterDownload.checked = false;
    selectRun(run.id);
    await refreshHistory();
    notice('upload-status');
    upload.querySelector('input[type=file]').value = '';
  } catch (error) { notice('upload-status', error.message, true); }
  finally {
    button.disabled = false;
    progress.hidden = true;
  }
});
historySearch.addEventListener('input', renderHistory);
byId('refresh-history').addEventListener('click', () => {
  void refreshHistory().catch(error => notice('upload-status', error.message, true));
});
pageSelect.addEventListener('change', async () => {
  const page = Number(pageSelect.value);
  if (await saveDraft()) await openPage(page);
  else if (state.page) pageSelect.value = state.page.number;
});
for (const [button, direction] of [['previous-page', -1], ['next-page', 1]]) byId(button).addEventListener('click', async () => {
  const target = pageSelect.options[pageSelect.selectedIndex + direction];
  if (target && await saveDraft()) await openPage(Number(target.value));
});
function toggleCorrection(open) {
  byId('correction-fields').hidden = !open;
  byId('page-proof').classList.toggle('with-correction', open);
  const toggle = byId('edit-selection');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? '收起侧栏' : '校对侧栏';
}
byId('edit-selection').addEventListener('click', async () => {
  const open = byId('correction-fields').hidden;
  if (open || await saveDraft()) toggleCorrection(open);
});
byId('close-correction').addEventListener('click', async () => {
  if (!(await saveDraft())) return;
  toggleCorrection(false);
  byId('edit-selection').focus();
});

function draftChanges() {
  const { page, selection } = state;
  if (!page || !selection) return null;
  const text = correction.value;
  const role = correctionRole.value || null;
  const group = byId('correction-group').checked;
  const ids = group ? page.items.filter(item => item.group === selection.group && item.kind === selection.kind).map(item => item.id) : [selection.id];
  const corrections = text === (selection.text ?? '') ? {} : { [selection.id]: text };
  const roles = group || role !== (selection.roleOverride ?? null) ? Object.fromEntries(ids.map(id => [id, role])) : {};
  const alignment = correctionAlignment.value || null;
  const alignments = correctionAlignment.disabled || alignment === (selection.alignmentOverride ?? null) ? {} : { [selection.id]: alignment };
  return Object.keys(corrections).length || Object.keys(roles).length || Object.keys(alignments).length ? { corrections, roles, alignments } : null;
}

function updateGenerateButton() {
  const info = state.source?.info;
  byId('generate-word').disabled = !info?.pages.length || !templateSelect.value || savingCorrection
    || submittingExport === state.source || (layoutMode.value === 'fixed' && !(questionLayout.value === 'page-images' ? info.sourcePdf : info.supportsFixed));
}

function updateDraftControls() {
  const dirty = Boolean(draftChanges());
  byId('save-correction').disabled = !dirty || savingCorrection;
  byId('discard-correction').hidden = !dirty || savingCorrection;
  for (const id of ['mark-stem', 'mark-option']) byId(id).disabled = savingCorrection;
  updateGenerateButton();
}

for (const input of [correction, correctionRole, correctionAlignment, byId('correction-group')]) input.addEventListener('input', updateDraftControls);
byId('discard-correction').addEventListener('click', () => setSelection(state.selection));

async function saveDraft({ lineRole } = {}) {
  if (savingCorrection) return false;
  const { source, page, selection } = state;
  if (!source || !page || !selection) return true;
  const changes = draftChanges() ?? (lineRole ? { corrections: {}, roles: {} } : null);
  if (!changes) return true;
  if (lineRole) {
    for (const item of lineTextItems(page, selection)) changes.roles[item.id] = lineRole;
  }
  savingCorrection = true;
  correction.disabled = correctionRole.disabled = correctionAlignment.disabled = byId('correction-group').disabled = true;
  updateDraftControls();
  notice('correction-status', '正在保存校对…');
  const scroll = byId('paper-scroll');
  const scrollTop = scroll.scrollTop;
  try {
    await previewData(`${source.base}/pages/${page.number}?mode=${page.layoutMode}`, 'PUT', changes);
    if (source !== state.source || page !== state.page) return false;
    if (layoutMode.value !== page.layoutMode) return true;
    if (Object.keys(changes.roles).length || Object.keys(changes.alignments ?? {}).length) {
      await openPage(page.number);
      if (source !== state.source) return false;
      if (!state.page) return true;
      setSelection(state.page.items.find(item => item.id === selection.id));
    } else {
      for (const item of page.items) {
        if (Object.hasOwn(changes.corrections, item.id)) {
          item.text = changes.corrections[item.id];
          item.crop = undefined;
        }
      }
      renderPage(page, source);
      setSelection(selection);
    }
    scroll.scrollTop = scrollTop;
    notice('correction-status', '校对已保存。');
    return true;
  } catch (error) {
    if (source === state.source) {
      toggleCorrection(true);
      notice('correction-status', `保存失败，修改仍保留在编辑框。 ${error.message}`, true);
    }
    return false;
  } finally {
    savingCorrection = false;
    correction.disabled = correctionRole.disabled = byId('correction-group').disabled = !state.selection;
    correctionAlignment.disabled = !state.selection || state.page?.layoutMode !== 'flow';
    updateDraftControls();
  }
}

for (const [id, role] of [['mark-stem', 'stem'], ['mark-option', 'option']]) {
  byId(id).addEventListener('click', () => saveDraft({ lineRole: role }));
}
byId('save-correction').addEventListener('click', () => saveDraft());
window.addEventListener('beforeunload', event => {
  if (!draftChanges()) return;
  event.preventDefault();
});

byId('clear-selection').addEventListener('click', async () => {
  if (!(await saveDraft())) return;
  const mark = [...byId('paper').querySelectorAll('[data-item]')].find(element => element.dataset.item === state.selection?.id);
  setSelection(null);
  mark?.focus();
});

byId('generate-word').addEventListener('click', async () => {
  const source = state.source;
  if (!source?.info || submittingExport === source || !(await saveDraft()) || state.source !== source || submittingExport === source) return;
  submittingExport = source;
  const button = byId('generate-word');
  button.disabled = true;
  notice('export-status', '正在提交生成任务…');
  try {
    const mode = layoutMode.value;
    const formulaMode = mode === 'fixed' && questionLayout.value === 'page-images' ? undefined : byId('export-formula-mode').value || undefined;
    await previewData(`${source.base}/exports`, 'POST', { template: templateSelect.value, mode, questionLayout: mode === 'fixed' ? questionLayout.value : undefined, formulaMode });
    if (source === state.source) {
      clearTimeout(state.exportTimer);
      notice('export-status', '已提交。生成进度和下载按钮会显示在下方。');
      await refreshExports(source);
    }
  } catch (error) { if (source === state.source) notice('export-status', error.message, true); }
  finally {
    if (submittingExport === source) submittingExport = undefined;
    if (source === state.source) updateTemplateAvailability(templateSelect.value);
  }
});
async function changeLayout(event) {
  const source = state.source;
  if (!source?.info) return;
  const control = event.currentTarget;
  const key = control === layoutMode ? 'mode' : 'variant';
  const storageKey = `${source.base}:${key}`;
  const previous = control === layoutMode ? state.page?.layoutMode ?? 'flow' : localStorage.getItem(storageKey) || 'adaptive-rows';
  if (!(await saveDraft()) || source !== state.source) {
    if (source === state.source) control.value = previous;
    return;
  }
  localStorage.setItem(storageKey, control.value);
  updateTemplateAvailability(templateSelect.value);
  if (pageSelect.value) await openPage(Number(pageSelect.value));
}
layoutMode.addEventListener('change', changeLayout);
questionLayout.addEventListener('change', changeLayout);
byId('edit-template').addEventListener('click', async () => { if (await saveDraft()) openEditor(); });
byId('export-formula-mode').addEventListener('change', async () => {
  if (!(await saveDraft()) || !state.page || !state.source) return;
  const selection = state.selection;
  renderPage(state.page, state.source);
  setSelection(selection);
});
byId('edit-template-id').addEventListener('change', event => showTemplate(event.target.value));
byId('use-default-template').addEventListener('click', () => {
  templateSelect.value = state.templates.find(template => template.default).id;
  templateSelect.dispatchEvent(new Event('change'));
  templateSelect.focus();
});
templateSelect.addEventListener('change', async () => {
  if (!(await saveDraft())) {
    updateTemplateAvailability();
    return;
  }
  localStorage.setItem(state.source ? `${state.source.base}:template` : templatePreference, templateSelect.value);
  updateTemplateAvailability(templateSelect.value);
  if (state.page && state.source) {
    const selection = state.selection;
    renderPage(state.page, state.source);
    if (selection) setSelection(selection);
  }
});
byId('new-template').addEventListener('click', () => { showTemplate(''); editorField('name').focus(); });
byId('paper-size').addEventListener('change', event => {
  const size = paperSizes[event.target.value];
  if (!size) {
    editorField('widthMm').focus();
    return;
  }
  setNumber(editorField('widthMm'), size[0]);
  setNumber(editorField('heightMm'), size[1]);
});
byId('auto-footer').addEventListener('input', previewTemplate);
byId('reset-element-style').addEventListener('click', () => {
  delete editorState.styles[editorState.role];
  showStyle(editorState.role);
  previewTemplate();
});
byId('inherit-body').addEventListener('change', () => {
  readStyle();
  previewTemplate();
});
byId('show-all-headings').addEventListener('change', () => {
  const invalid = [...editor.querySelectorAll('[data-style]')].find(field => !field.checkValidity());
  if (invalid) {
    byId('show-all-headings').checked = !byId('show-all-headings').checked;
    invalid.reportValidity();
    return;
  }
  readStyle();
  refreshStyleOptions();
  previewTemplate();
});
styleSelect.addEventListener('change', () => {
  const invalid = [...editor.querySelectorAll('[data-style]')].find(field => !field.checkValidity());
  if (invalid) {
    styleSelect.value = editorState.role;
    invalid.reportValidity();
    return;
  }
  readStyle();
  showStyle(styleSelect.value);
  previewTemplate();
});
editor.addEventListener('input', event => {
  if (!event.target.matches('input:not([type=file]), select[name], select[data-style]')) return;
  if (numericControls.has(event.target)) updateNumericControl(event.target);
  if (event.target.id === 'style-color-picker') editor.querySelector('[data-style="color"]').value = event.target.value.toUpperCase();
  if (!event.target.validity.valid) return;
  readStyle();
  previewTemplate();
});
editor.addEventListener('submit', async event => {
  event.preventDefault();
  const invalid = [...editor.elements].find(field => field.willValidate && !field.validity.valid);
  if (invalid) {
    const pane = invalid.closest('.editor-pane');
    if (pane) showPane(pane.id.slice('pane-'.length));
    invalid.reportValidity();
    return;
  }
  readStyle();
  const data = templateDraft();
  const save = editorState.id && event.submitter?.value === 'save' && !state.templates.find(template => template.id === editorState.id)?.preset;
  try {
    const result = await api(save ? `/api/templates/${editorState.id}` : '/api/templates', save ? 'PUT' : 'POST', data);
    await loadTemplates(result.id);
    showTemplate(result.id);
    notice('template-status', `已保存模板「${result.name}」。`);
  } catch (error) { notice('template-status', error.message, true); }
});
byId('import-template').addEventListener('click', () => byId('template-file').click());
byId('template-file').addEventListener('change', async event => {
  const input = event.target;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 128 * 1024) throw new Error('模板文件不能超过 128 KB。');
    const contents = await file.text();
    let data;
    try { data = JSON.parse(contents.replace(/^\uFEFF/, '')); }
    catch { throw new Error('模板文件不是有效的 JSON。'); }
    const imported = await api('/api/templates/import', 'POST', data);
    await loadTemplates(imported.id);
    showTemplate(imported.id);
    notice('template-status', `已导入「${imported.name}」。`);
  } catch (error) { notice('template-status', error.message, true); }
});
byId('delete-template').addEventListener('click', async () => {
  if (!confirm('删除这个自定义模板？')) return;
  try { await api(`/api/templates/${editorState.id}`, 'DELETE'); await loadTemplates(); showTemplate(templateSelect.value); }
  catch (error) { notice('template-status', error.message, true); }
});

(async () => {
  const params = new URLSearchParams(location.search);
  try {
    const [config] = await Promise.all([api('/api/config'), refreshHistory(), loadTemplates()]);
    state.mixedLayouts = config.mixedLayouts === true;
    byId('upload-button').disabled = !config.tokenConfigured;
    if (!config.tokenConfigured) notice('upload-status', '请配置 MinerU Token 后再上传。已有记录仍可导出。');
    byId('retention-note').textContent = config.retentionMinutes
      ? `PDF 将发送给 MinerU 识别。本站任务文件从开始上传起保留 ${config.retentionMinutes} 分钟。`
      : 'PDF 将发送给 MinerU 识别。本站保留任务文件，直至手动清除。';
    const id = params.get('run');
    if (id) {
      selectRun(id, { fileId: params.get('file'), model: params.get('model') });
    }
  } catch (error) { notice('upload-status', error.message, true); }
})();
