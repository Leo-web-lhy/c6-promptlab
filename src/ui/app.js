/**
 * app.js — 视图与交互层（唯一接触 DOM 的地方）
 *
 * 分层：core/* 是纯函数（有单测），这里只负责「读输入 → 调 core → 重渲染」。
 * 所以界面出问题不会污染数据规则，core 改规则也不用动 DOM 代码。
 */
import {
  parseVariables, render, templateStats,
} from '../core/template.js';
import { diffLines, summarize } from '../core/diff.js';
import {
  summarizeScores, bootstrapDiffCI, verdictText,
} from '../core/stats.js';
import {
  createPrompt, addVersion, addRun, removePrompt, removeRun,
  scoresOfVersion, searchPrompts,
} from '../core/store.js';
import {
  backend, load, save, exportJson, importJson, clearAll, STORAGE_KEY,
} from '../core/persist.js';

/* ---------------- 运行时状态（不持久化，刷新即重算） ---------------- */
let state = null;
let activeVersionId = null;
let valuesByVersion = {};   // { versionId: { varName: value } }
let lastRender = null;      // { versionId, output, missing, used }
let searchKeyword = '';

const $ = (id) => document.getElementById(id);

/* ---------------- 小工具 ---------------- */
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    }
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

let toastTimer = null;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x) => (Number.isFinite(x) ? Math.round(x * 100) + '%' : '—');

function timeStr(ts) {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 当前选中的提示词对象 */
function activePrompt() {
  if (!state) return null;
  return state.prompts.find((p) => p.id === state.settings.activePromptId) || null;
}

/** 当前选中的版本对象 */
function activeVersion(prompt) {
  const p = prompt || activePrompt();
  if (!p || !p.versions.length) return null;
  return p.versions.find((v) => v.id === activeVersionId) || p.versions[p.versions.length - 1];
}

/** 提交一次状态变更：core 返回新 state，这里统一落盘 + 重渲染 */
function commit(nextState) {
  state = nextState;
  save(state);
  renderAll();
}

/* ---------------- 侧边栏 ---------------- */
function renderSidebar() {
  const list = $('promptList');
  clear(list);
  const items = searchPrompts(state, searchKeyword);
  $('emptyHint').hidden = items.length > 0;

  for (const p of items) {
    const isActive = p.id === state.settings.activePromptId;
    const last = p.versions[p.versions.length - 1];
    const vars = last ? parseVariables(last.body).length : 0;
    list.append(el('li', {
      class: isActive ? 'active' : '',
      role: 'option',
      'aria-selected': String(isActive),
      onclick: () => {
        state.settings.activePromptId = p.id;
        activeVersionId = p.versions.length ? p.versions[p.versions.length - 1].id : null;
        save(state);
        renderAll();
      },
    },
    el('span', { class: 'li-name', text: p.name }),
    el('span', { class: 'li-meta', text: `v${p.versions.length}·${p.runs.length}跑·${vars}变量` })));
  }

  if (!items.length && state.prompts.length) {
    list.append(el('li', { class: 'empty', text: '没有匹配的提示词' }));
  }
}

/* ---------------- 编辑页 ---------------- */
function renderEditor() {
  const p = activePrompt();
  const v = activeVersion(p);
  const editable = !!p;

  $('promptName').value = p ? p.name : '';
  $('promptName').disabled = !editable;
  $('btnRename').disabled = !editable;
  $('btnDeletePrompt').disabled = !editable;
  $('btnSaveVersion').disabled = !editable;

  // 版本标签
  const tabs = $('versionTabs');
  clear(tabs);
  if (p) {
    for (const ver of p.versions) {
      const nRuns = p.runs.filter((r) => r.versionId === ver.id).length;
      tabs.append(el('button', {
        class: 'vchip' + (v && v.id === ver.id ? ' active' : ''),
        type: 'button',
        title: ver.note || '（无版本说明）',
        onclick: () => {
          activeVersionId = ver.id;
          renderAll();
        },
      }, `v${ver.n}`, nRuns ? el('span', { class: 'dot', text: ` ·${nRuns}跑` }) : null));
    }
    tabs.append(el('span', {
      class: 'muted',
      style: 'margin-left:auto;align-self:center',
      text: `共 ${p.versions.length} 版 · ${p.runs.length} 次运行`,
    }));
  }

  const editor = $('editor');
  const body = v ? v.body : '';
  if (document.activeElement !== editor) editor.value = body;
  editor.disabled = !editable;

  updateEditorMeta();
  renderVarsPanel();
}

function updateEditorMeta() {
  const s = templateStats($('editor').value);
  $('editorMeta').textContent = `${s.chars} 字符 · ${s.lines} 行 · ${s.variables} 个变量`;
}

/** 编辑页只展示识别到的变量（只读），填值在「运行」页 */
function renderVarsPanel() {
  const box = $('varsPanel');
  clear(box);
  const vars = parseVariables($('editor').value);
  if (!vars.length) {
    box.append(el('p', {
      class: 'muted',
      text: '这个模板没有变量。加 {{变量名}} 就能在运行页填值，同一份模板反复复用。',
    }));
    return;
  }
  for (const name of vars) {
    box.append(el('div', { class: 'var-field' },
      el('label', { text: `{{${name}}}` }),
      el('input', { value: '', placeholder: '在「运行」页填写', disabled: 'disabled' })));
  }
}

/* ---------------- 运行页 ---------------- */
function renderRun() {
  const p = activePrompt();
  const sel = $('runVersion');
  clear(sel);
  if (!p || !p.versions.length) {
    $('btnRender').disabled = true;
    $('btnLogRun').disabled = true;
    clear($('runVars'));
    $('runOutput').textContent = p ? '先在「编辑」页保存一个版本。' : '先新建一个提示词。';
    clearRunTable();
    return;
  }

  const v = activeVersion(p);
  for (const ver of p.versions) {
    const n = p.runs.filter((r) => r.versionId === ver.id).length;
    sel.append(el('option', { value: ver.id, selected: ver.id === v.id ? 'selected' : '' },
      `v${ver.n}${ver.note ? ' · ' + ver.note : ''}（${n} 次运行）`));
  }
  $('btnRender').disabled = false;
  $('btnLogRun').disabled = false;

  renderRunVars(p, v);
  renderRunTable(p);
}
/** 运行页的变量输入框：按当前版本正文动态生成，值按版本分别记住 */
function renderRunVars(p, v) {
  const box = $('runVars');
  clear(box);
  const vars = parseVariables(v.body);
  const store = valuesByVersion[v.id] || (valuesByVersion[v.id] = {});
  if (!vars.length) {
    box.append(el('p', { class: 'muted', text: '这个版本没有变量，直接点「渲染输出」即可。' }));
    return;
  }
  for (const name of vars) {
    const input = el('input', {
      class: 'runvar',
      placeholder: '填一个值',
      'data-var': name,
      value: store[name] === undefined ? '' : store[name],
    });
    input.addEventListener('input', () => { store[name] = input.value; });
    box.append(el('div', { class: 'var-field' },
      el('label', { text: `{{${name}}}` }), input));
  }
}

function collectValues() {
  const out = {};
  for (const input of $('runVars').querySelectorAll('input.runvar')) {
    const name = input.getAttribute('data-var');
    if (name) out[name] = input.value;
  }
  return out;
}

/** 渲染并缓存；返回 { versionId, output, missing, used } */
function doRender(silent) {
  const p = activePrompt();
  const v = activeVersion(p);
  if (!p || !v) return null;
  const values = collectValues();
  valuesByVersion[v.id] = values;
  const r = render(v.body, values);
  lastRender = { versionId: v.id, output: r.output, missing: r.missing, used: r.used };
  $('runOutput').textContent = r.output;
  if (r.missing.length && !silent) {
    toast(`有 ${r.missing.length} 个变量未填，占位符原样保留：${r.missing.join(', ')}`, true);
  }
  return lastRender;
}

function logRun() {
  const p = activePrompt();
  const v = activeVersion(p);
  if (!p || !v) return;
  const lr = (lastRender && lastRender.versionId === v.id) ? lastRender : doRender(true);
  const score = Number($('runScore').value);
  const note = $('runNote').value;
  try {
    const res = addRun(state, p.id, {
      versionId: v.id,
      values: valuesByVersion[v.id] || {},
      output: lr ? lr.output : '',
      score,
      note,
    });
    $('runNote').value = '';
    commit(res.state);
    toast(`已记录：v${v.n} · ${score} 分`);
  } catch (err) {
    toast(err.message, true);
  }
}

function clearRunTable() {
  const tb = $('runsTable').querySelector('tbody');
  clear(tb);
  tb.append(el('tr', {}, el('td', { colspan: '5', class: 'muted', text: '还没有运行记录。' })));
}

function renderRunTable(p) {
  const tb = $('runsTable').querySelector('tbody');
  clear(tb);
  if (!p || !p.runs.length) { clearRunTable(); return; }
  const vname = (vid) => {
    const v = p.versions.find((x) => x.id === vid);
    return v ? `v${v.n}` : '?';
  };
  const rows = [...p.runs].sort((a, b) => b.createdAt - a.createdAt);
  for (const r of rows) {
    tb.append(el('tr', {},
      el('td', { class: 'num', text: timeStr(r.createdAt) }),
      el('td', { text: vname(r.versionId) }),
      el('td', { class: 'num', text: String(r.score) }),
      el('td', { text: r.note || '—' }),
      el('td', {}, el('button', {
        class: 'mini',
        type: 'button',
        onclick: () => {
          try {
            commit(removeRun(state, p.id, r.id));
            toast('已删除该条运行记录');
          } catch (err) { toast(err.message, true); }
        },
      }, '删除'))));
  }
}

/* ---------------- 对比页 ---------------- */
function statCard(title, s, extra) {
  return el('div', { class: 'stat-card' },
    el('h4', { text: title }),
    el('div', { class: 'big', text: fmt(s.mean) }),
    el('div', { class: 'sub', text: `n=${s.n} · sd=${fmt(s.sd)} · ${Number.isFinite(s.min) ? s.min + '~' + s.max : '无数据'}` }),
    extra ? el('div', { class: 'sub', text: extra }) : null);
}

function renderCompare() {
  const p = activePrompt();
  const selA = $('cmpA');
  const selB = $('cmpB');
  const grid = $('cmpStats');
  const verdict = $('cmpVerdict');
  const diffView = $('diffView');
  const diffSum = $('diffSummary');
  const keepA = selA.value;
  const keepB = selB.value;

  clear(selA); clear(selB); clear(grid); clear(diffView);
  diffSum.textContent = '';

  if (!p || !p.versions.length) {
    verdict.className = 'verdict';
    verdict.textContent = '还没有版本可比较。先在「编辑」页保存至少两版，再给它们各记录几次运行。';
    return;
  }

  const vs = p.versions;
  const defA = vs.length > 1 ? vs[vs.length - 2].id : vs[0].id;
  const defB = vs[vs.length - 1].id;
  const pickA = vs.some((v) => v.id === keepA) ? keepA : defA;
  const pickB = vs.some((v) => v.id === keepB) ? keepB : defB;

  for (const v of vs) {
    const n = p.runs.filter((r) => r.versionId === v.id).length;
    const label = `v${v.n}${v.note ? ' · ' + v.note : ''}（${n} 跑）`;
    selA.append(el('option', { value: v.id, text: label, selected: v.id === pickA ? 'selected' : '' }));
    selB.append(el('option', { value: v.id, text: label, selected: v.id === pickB ? 'selected' : '' }));
  }

  const va = vs.find((v) => v.id === pickA);
  const vb = vs.find((v) => v.id === pickB);
  const sa = summarizeScores(scoresOfVersion(p, va.id));
  const sb = summarizeScores(scoresOfVersion(p, vb.id));

  grid.append(statCard(`A · v${va.n} 对照`, sa), statCard(`B · v${vb.n} 实验`, sb));

  let ci = null;
  if (va.id === vb.id) {
    verdict.className = 'verdict';
    verdict.textContent = 'A 和 B 选的是同一版本，差异恒为 0。换一个版本再比。';
  } else if (sa.n === 0 || sb.n === 0) {
    verdict.className = 'verdict';
    verdict.textContent = '两组都要有运行记录才能做显著性判断：A 有 ' + sa.n + ' 条，B 有 ' + sb.n + ' 条。';
  } else {
    ci = bootstrapDiffCI(scoresOfVersion(p, va.id), scoresOfVersion(p, vb.id), { iterations: 4000, seed: 20261119 });
    const delta = sb.mean - sa.mean;
    grid.append(statCard('Δ（B − A）', {
      mean: ci.diff, n: ci.nA + ci.nB, sd: NaN, min: ci.low, max: ci.high,
    }, `95% CI [${fmt(ci.low)}, ${fmt(ci.high)}] · ${ci.iterations} 次重采样`));
    const cls = ci.significant ? 'verdict sig' : 'verdict nosig';
    verdict.className = cls;
    verdict.textContent = verdictText(ci)
      + `  实测 Δ=${fmt(delta)}，区间 [${fmt(ci.low)}, ${fmt(ci.high)}]。`
      + ' 区间跨 0 视为「分不出差别」，不要凭均值高低下结论。';
  }

  const d = diffLines(va.body, vb.body);
  const sum = summarize(d);
  diffSum.textContent = `v${va.n} → v${vb.n}：+${sum.added} 行 / −${sum.removed} 行 / 相同 ${sum.same} 行 · 相似度 ${pct(sum.similarity)}`
    + (sum.identical ? ' · 正文完全一致' : '');

  const LIMIT = 400;
  const shown = d.slice(0, LIMIT);
  for (const row of shown) {
    const mark = row.type === 'add' ? '+' : (row.type === 'del' ? '−' : ' ');
    const no = row.type === 'add' ? row.afterLine : row.beforeLine;
    diffView.append(el('div', { class: 'diff-line ' + row.type },
      el('span', { class: 'ln', text: String(no || '') }),
      el('span', { class: 'mark', text: mark }),
      el('span', { text: row.text === '' ? '' : row.text })));
  }
  if (d.length > LIMIT) {
    diffView.append(el('div', { class: 'diff-line same' },
      el('span', { class: 'ln', text: '…' }),
      el('span', { class: 'mark', text: '' }),
      el('span', { text: `差异过长，仅渲染前 ${LIMIT} 行（共 ${d.length} 行）` })));
  }
}
/* ---------------- 存档页 ---------------- */
function renderData() {
  const info = $('dataInfo');
  clear(info);
  let versions = 0;
  let runs = 0;
  for (const p of state.prompts) {
    versions += p.versions.length;
    runs += p.runs.length;
  }
  const cells = [
    ['存储后端', backend() === 'localStorage' ? '本机浏览器 localStorage' : '内存（关闭即丢）'],
    ['存储键', STORAGE_KEY],
    ['提示词', state.prompts.length],
    ['版本快照', versions],
    ['运行记录', runs],
    ['最后更新', state.updatedAt ? timeStr(state.updatedAt) : '—'],
  ];
  const badge = $('backendBadge');
  const b = backend();
  badge.textContent = '存储：' + (b === 'localStorage' ? '本机' : '内存');
  badge.className = 'badge ' + b;

  for (const [k, v] of cells) {
    info.append(el('div', { class: 'data-cell' },
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v', text: String(v) })));
  }
}

/* ---------------- 浏览器内自检 ---------------- */
function runSelfTest() {
  const lines = [];
  const ok = (name, cond, detail) => {
    lines.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
    return cond;
  };

  const r1 = render('A{{x}}B', { x: '1' });
  ok('模板渲染替换变量', r1.output === 'A1B', r1.output);

  const r2 = render('{{missing}}', {});
  ok('缺失变量保留占位符并如实报告', r2.missing.length === 1 && r2.output === '{{missing}}', JSON.stringify(r2.missing));

  const r3 = render('{{zero}}|{{empty}}', { zero: 0, empty: '' });
  ok('0 与空串算「已给值」，不算缺失', r3.missing.length === 0, r3.output);

  const d = summarize(diffLines('a\nb\nc\nd', 'a\nB\nc\nd'));
  ok('行差异统计（4 行改 1 行 → 相似度 0.75）',
    d.added === 1 && d.removed === 1 && Math.abs(d.similarity - 0.75) < 1e-9,
    `+${d.added}/-${d.removed}/${d.similarity}`);

  const s = summarizeScores([1, 2, 3, 4, 5]);
  ok('均值精确、标准差落在样本口径区间',
    Math.abs(s.mean - 3) < 1e-9 && s.sd > 1.4 && s.sd < 1.6,
    `mean=${s.mean} sd=${s.sd.toFixed(4)}`);

  const ci = bootstrapDiffCI([5, 5, 5, 5, 4, 5, 5, 5], [2, 2, 3, 2, 2, 2, 3, 2], { iterations: 800, seed: 7 });
  ok('明显分离的两组判为显著且区间不跨 0',
    ci.significant === true && ci.low > 0, `[${fmt(ci.low)}, ${fmt(ci.high)}]`);

  const ci2 = bootstrapDiffCI([3, 4, 3, 4, 3], [4, 3, 4, 3, 4], { iterations: 800, seed: 7 });
  ok('几乎无差的两组不硬判显著', ci2.significant === false, `[${fmt(ci2.low)}, ${fmt(ci2.high)}]`);

  const round = importJson(exportJson(state));
  ok('导出 → 导入可还原',
    round.ok === true && round.state.prompts.length === state.prompts.length,
    round.ok ? `prompts=${round.stats.prompts}` : String(round.error));

  const bad = importJson('{"prompts":"not-an-array"}');
  ok('损坏数据被拒绝而不是静默写入', bad.ok === false, String(bad.error || ''));

  const pass = lines.filter((l) => l.startsWith('PASS')).length;
  $('selfTestOut').textContent = lines.join('\n')
    + `\n\n${pass}/${lines.length} 通过` + (pass === lines.length ? ' ✅' : ' ❌');
  toast(pass === lines.length ? '自检全部通过' : '自检存在失败项', pass !== lines.length);
}

/* ---------------- 总渲染 ---------------- */
function renderAll() {
  if (!state) return;
  renderSidebar();
  renderEditor();
  renderRun();
  renderCompare();
  renderData();
}

/* ---------------- 导入导出 ---------------- */
function downloadJson() {
  const text = exportJson(state);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `promptlab-${Date.now()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('已导出 JSON 文件');
}

function handleImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const res = importJson(String(reader.result || ''));
    if (!res.ok) {
      toast('导入失败：' + res.error, true);
      return;
    }
    activeVersionId = null;
    lastRender = null;
    valuesByVersion = {};
    commit(res.state);
    toast(`导入成功：${res.stats.prompts} 提示词 / ${res.stats.versions} 版本 / ${res.stats.runs} 运行`);
  };
  reader.onerror = () => toast('文件读取失败', true);
  reader.readAsText(file, 'utf-8');
}

/* ---------------- 改名（仅名称，不动版本） ---------------- */
function doRename() {
  const p = activePrompt();
  if (!p) return;
  const name = $('promptName').value.trim();
  if (!name || name === p.name) {
    $('promptName').value = p.name;
    return;
  }
  const next = JSON.parse(JSON.stringify(state));
  const target = next.prompts.find((x) => x.id === p.id);
  target.name = name;
  target.updatedAt = Date.now();
  next.updatedAt = target.updatedAt;
  commit(next);
  toast('已改名');
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $('btnNewPrompt').addEventListener('click', () => {
    const res = createPrompt(state, `提示词 ${state.prompts.length + 1}`);
    activeVersionId = null;
    lastRender = null;
    commit(res.state);
    $('promptName').focus();
    $('promptName').select();
    toast('已新建，写完正文后点「保存为新版本」');
  });

  $('search').addEventListener('input', (e) => {
    searchKeyword = e.target.value;
    renderSidebar();
  });

  $('promptName').addEventListener('change', doRename);
  $('btnRename').addEventListener('click', doRename);

  $('btnDeletePrompt').addEventListener('click', () => {
    const p = activePrompt();
    if (!p) return;
    const msg = `删除「${p.name}」及其 ${p.versions.length} 个版本、${p.runs.length} 条运行记录？不可撤销。`;
    if (!confirm(msg)) return;
    activeVersionId = null;
    lastRender = null;
    commit(removePrompt(state, p.id));
    toast('已删除');
  });

  $('btnSaveVersion').addEventListener('click', () => {
    const p = activePrompt();
    if (!p) return;
    try {
      const res = addVersion(state, p.id, $('editor').value, $('versionNote').value);
      activeVersionId = res.version.id;
      $('versionNote').value = '';
      commit(res.state);
      toast(`已保存 v${res.version.n}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('editor').addEventListener('input', () => {
    updateEditorMeta();
    renderVarsPanel();
  });

  $('runVersion').addEventListener('change', (e) => {
    activeVersionId = e.target.value;
    lastRender = null;
    renderAll();
  });

  $('btnRender').addEventListener('click', () => {
    if (doRender(false)) toast('已渲染');
  });

  $('btnLogRun').addEventListener('click', logRun);

  $('btnCompare').addEventListener('click', () => {
    renderCompare();
    toast('已重新计算');
  });
  $('cmpA').addEventListener('change', renderCompare);
  $('cmpB').addEventListener('change', renderCompare);

  $('btnExport').addEventListener('click', downloadJson);
  $('btnExport2').addEventListener('click', downloadJson);
  for (const id of ['fileImport', 'fileImport2']) {
    $(id).addEventListener('change', (e) => {
      handleImport(e.target.files[0]);
      e.target.value = '';
    });
  }

  $('btnClear').addEventListener('click', () => {
    if (!confirm('清空本机所有 PromptLab 数据？已导出的 JSON 文件不受影响。')) return;
    clearAll();
    state = load().state;
    activeVersionId = null;
    valuesByVersion = {};
    lastRender = null;
    renderAll();
    toast('已清空');
  });

  $('btnSelfTest').addEventListener('click', runSelfTest);

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.tab')) {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      }
      for (const pane of document.querySelectorAll('.tabpane')) {
        pane.classList.toggle('active', pane.getAttribute('data-pane') === tab.getAttribute('data-tab'));
      }
      if (tab.getAttribute('data-tab') === 'compare') renderCompare();
      if (tab.getAttribute('data-tab') === 'run') renderRun();
    });
  }
}

/* ---------------- 启动 ---------------- */
function boot() {
  const loaded = load();
  state = loaded.state;
  if (loaded.warning) {
    const bar = $('warningBar');
    bar.hidden = false;
    bar.textContent = loaded.warning + '——请用「导出 JSON」保存记录。';
  }
  const p = activePrompt();
  activeVersionId = p && p.versions.length ? p.versions[p.versions.length - 1].id : null;
  bind();
  renderAll();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线缓存失败不影响主功能 */ });
  }
}

boot();
