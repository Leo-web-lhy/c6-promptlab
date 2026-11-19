/**
 * store.js — 数据模型与状态变更（纯函数，无 DOM / 无存储依赖）
 *
 * 分层意图：
 *   store.js  只管「状态怎么变、怎么校验」——可在 Node 里直接单测
 *   persist.js 只管「状态存到哪」（localStorage / 内存降级）
 * 这样存储失败不会污染业务逻辑，业务规则也不会被存储细节绑死。
 */

export const SCHEMA_VERSION = 2;

/** 生成短 id（不依赖 crypto，纯函数可测） */
export function makeId(prefix, seed) {
  const n = Number.isFinite(seed) ? seed : Date.now();
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}_${n.toString(36)}${rand}`;
}

/** 空状态 */
export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    prompts: [],
    settings: { theme: 'dark', activePromptId: null },
    createdAt: null,
    updatedAt: null,
  };
}

/** 新建一个提示词（不带版本） */
export function createPrompt(state, name, now) {
  const ts = Number.isFinite(now) ? now : Date.now();
  const prompt = {
    id: makeId('p', ts),
    name: String(name || '未命名提示词').trim() || '未命名提示词',
    createdAt: ts,
    updatedAt: ts,
    versions: [],
    runs: [],
  };
  const next = clone(state);
  next.prompts.push(prompt);
  next.settings.activePromptId = prompt.id;
  next.updatedAt = ts;
  if (!next.createdAt) next.createdAt = ts;
  return { state: next, prompt };
}

/**
 * 追加一个不可变版本快照。版本号连续递增，旧版本永不改写。
 * @returns {{state, version}}
 */
export function addVersion(state, promptId, body, note, now) {
  const ts = Number.isFinite(now) ? now : Date.now();
  const next = clone(state);
  const prompt = next.prompts.find((p) => p.id === promptId);
  if (!prompt) throw new Error('prompt not found: ' + promptId);
  const text = String(body === undefined || body === null ? '' : body);
  if (text.trim() === '') throw new Error('版本正文不能为空');

  const last = prompt.versions[prompt.versions.length - 1];
  if (last && last.body === text) {
    // 内容没变就不制造一个空版本，避免版本号被噪声灌满
    throw new Error('与上一版内容完全相同，无需新建版本');
  }

  const version = {
    id: makeId('v', ts),
    n: prompt.versions.length + 1,
    body: text,
    note: String(note || '').trim(),
    createdAt: ts,
  };
  prompt.versions.push(version);
  prompt.updatedAt = ts;
  next.updatedAt = ts;
  return { state: next, version };
}

/** 记录一次评测运行（输出 + 人工评分） */
export function addRun(state, promptId, run, now) {
  const ts = Number.isFinite(now) ? now : Date.now();
  const next = clone(state);
  const prompt = next.prompts.find((p) => p.id === promptId);
  if (!prompt) throw new Error('prompt not found: ' + promptId);
  if (!prompt.versions.some((v) => v.id === run.versionId)) {
    throw new Error('version not found: ' + run.versionId);
  }
  const score = Number(run.score);
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    throw new Error('评分必须是 1..5 之间的整数');
  }
  const record = {
    id: makeId('r', ts),
    versionId: run.versionId,
    values: Object.assign({}, run.values || {}),
    output: String(run.output === undefined || run.output === null ? '' : run.output),
    score: Math.round(score),
    note: String(run.note || '').trim(),
    createdAt: ts,
  };
  prompt.runs.push(record);
  prompt.updatedAt = ts;
  next.updatedAt = ts;
  return { state: next, run: record };
}

/** 删除提示词 / 版本 / 运行记录 */
export function removePrompt(state, promptId) {
  const next = clone(state);
  next.prompts = next.prompts.filter((p) => p.id !== promptId);
  if (next.settings.activePromptId === promptId) {
    next.settings.activePromptId = next.prompts.length ? next.prompts[0].id : null;
  }
  next.updatedAt = Date.now();
  return next;
}

export function removeRun(state, promptId, runId) {
  const next = clone(state);
  const prompt = next.prompts.find((p) => p.id === promptId);
  if (!prompt) throw new Error('prompt not found: ' + promptId);
  prompt.runs = prompt.runs.filter((r) => r.id !== runId);
  next.updatedAt = Date.now();
  return next;
}

/** 取某个版本的评分数组 */
export function scoresOfVersion(prompt, versionId) {
  return prompt.runs.filter((r) => r.versionId === versionId).map((r) => r.score);
}

/** 搜索：匹配提示词名、版本正文、运行备注 */
export function searchPrompts(state, keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return state.prompts;
  return state.prompts.filter((p) => {
    if (p.name.toLowerCase().includes(kw)) return true;
    if (p.versions.some((v) => v.body.toLowerCase().includes(kw) || v.note.toLowerCase().includes(kw))) {
      return true;
    }
    return p.runs.some((r) => r.note.toLowerCase().includes(kw) || r.output.toLowerCase().includes(kw));
  });
}

function clone(obj) {
  // structuredClone 在 Node 17+/现代浏览器可用；退回 JSON 以保持兼容
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch (e) {
      /* fallthrough */
    }
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 校验并规范化导入的 JSON。损坏数据一律拒绝，不做「尽力修复」，
 * 避免把残缺结构写进用户存档。
 * @returns {{ok: boolean, state?: object, error?: string, stats?: object}}
 */
export function validateImport(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败：' + e.message };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '顶层必须是对象' };
  }
  if (!Array.isArray(data.prompts)) {
    return { ok: false, error: '缺少 prompts 数组' };
  }
  let promptCount = 0;
  let versionCount = 0;
  let runCount = 0;
  const prompts = [];
  try {
  for (const p of data.prompts) {
    if (!p || typeof p !== 'object') return { ok: false, error: 'prompts 中存在非对象项' };
    if (typeof p.id !== 'string' || typeof p.name !== 'string') {
      return { ok: false, error: '提示词缺少 id 或 name' };
    }
    if (!Array.isArray(p.versions) || !Array.isArray(p.runs)) {
      return { ok: false, error: `提示词 ${p.name} 缺少 versions/runs 数组` };
    }
    const versions = p.versions.map((v, i) => {
      if (typeof v.body !== 'string') throw new Error(`提示词 ${p.name} 的第 ${i + 1} 个版本正文不是字符串`);
      return {
        id: String(v.id || makeId('v', i)),
        n: Number.isFinite(v.n) ? v.n : i + 1,
        body: v.body,
        note: String(v.note || ''),
        createdAt: Number.isFinite(v.createdAt) ? v.createdAt : Date.now(),
      };
    });
    const versionIds = new Set(versions.map((v) => v.id));
    const runs = p.runs.map((r, i) => {
      if (!versionIds.has(r.versionId)) {
        throw new Error(`提示词 ${p.name} 的第 ${i + 1} 条运行记录指向不存在的版本`);
      }
      const s = Number(r.score);
      if (!Number.isFinite(s) || s < 1 || s > 5) {
        throw new Error(`提示词 ${p.name} 的第 ${i + 1} 条运行记录评分越界`);
      }
      return {
        id: String(r.id || makeId('r', i)),
        versionId: r.versionId,
        values: r.values && typeof r.values === 'object' ? r.values : {},
        output: String(r.output || ''),
        score: Math.round(s),
        note: String(r.note || ''),
        createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
      };
    });
    prompts.push({
      id: p.id,
      name: p.name,
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
      updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : Date.now(),
      versions,
      runs,
    });
    promptCount++;
    versionCount += versions.length;
    runCount += runs.length;
  }
  } catch (e) {
    // 校验失败统一转成 {ok:false}：导入路径需要可预期的返回值，
    // 不能让 throw 穿透到 UI（否则一次坏存档会中断整个启动流程）
    return { ok: false, error: e.message };
  }
  return {
    ok: true,
    state: {
      schemaVersion: SCHEMA_VERSION,
      prompts,
      settings: Object.assign({ theme: 'dark', activePromptId: null }, data.settings || {}),
      createdAt: Number.isFinite(data.createdAt) ? data.createdAt : Date.now(),
      updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now(),
    },
    stats: { prompts: promptCount, versions: versionCount, runs: runCount },
  };
}
