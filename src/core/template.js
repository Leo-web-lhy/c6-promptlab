/**
 * template.js — 变量模板解析与渲染（纯函数，无 DOM 依赖）
 *
 * 支持语法：
 *   {{name}}       普通变量，缺失时记入 missing
 *   {{ name }}     两侧空白自动裁剪
 *   {{a.b-c_1}}    变量名允许字母、数字、下划线、点、连字符
 *
 * 设计取舍：
 * - 不做表达式求值（避免 eval 与注入面），只做整值替换。
 * - 渲染结果同时对「缺失变量」和「多余变量值」做报告，便于 UI 提示。
 */

const VAR_RE = /\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g;

/** 变量名合法字符集（供 UI 校验使用） */
export const VAR_NAME_RE = /^[A-Za-z0-9_.\-]+$/;

/**
 * 扫描模板中的变量名，按出现顺序去重返回。
 * @param {string} text
 * @returns {string[]}
 */
export function parseVariables(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const seen = new Set();
  const out = [];
  // 每次调用重建正则，避免 lastIndex 状态泄漏
  const re = new RegExp(VAR_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * 渲染模板。
 * @param {string} text 模板正文
 * @param {Record<string, string>} values 变量值表
 * @returns {{output: string, missing: string[], used: string[], unused: string[]}}
 */
export function render(text, values) {
  const vals = values || {};
  const used = parseVariables(text);
  // 只把 undefined / null 判为缺失：空字符串与 0 都是用户显式给的值。
  // 早期版本把 '' 也算缺失，导致「missing 说缺了但 output 已渲染成空」的自相矛盾。
  const missing = used.filter((n) => vals[n] === undefined || vals[n] === null);
  const unused = Object.keys(vals).filter((k) => !used.includes(k));

  const output = String(text === undefined || text === null ? '' : text).replace(
    new RegExp(VAR_RE.source, 'g'),
    (whole, name) => {
      const v = vals[name];
      // 缺失时保留占位符原样，让使用者一眼看到未填项，而不是被静默清空
      return v === undefined || v === null ? whole : String(v);
    }
  );

  return { output, missing, used, unused };
}

/**
 * 统计模板规模，用于版本列表展示。
 * @param {string} text
 */
export function templateStats(text) {
  const s = typeof text === 'string' ? text : '';
  const lines = s.length === 0 ? 0 : s.split(/\r\n|\r|\n/).length;
  return {
    chars: s.length,
    lines,
    variables: parseVariables(s).length,
  };
}
