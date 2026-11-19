/**
 * diff.js — 行级差异比较（纯函数，无 DOM 依赖）
 *
 * 算法：经典 LCS 动态规划，回溯生成编辑脚本。
 * 复杂度 O(n*m) 时间与空间；对超过阈值的输入自动退化为「整体替换」，
 * 避免在超长文本上把浏览器卡死（产品里真实存在的边界）。
 */

export const MAX_CELLS = 4_000_000; // 2000 x 2000 行

/**
 * 把文本切成行数组，保留空行语义。
 * @param {string} text
 * @returns {string[]}
 */
export function toLines(text) {
  if (text === undefined || text === null || text === '') return [];
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = s.split('\n');
  // 结尾单个换行只是行终止符，不额外造一行；`a\n\n` 才代表存在一个真实的尾空行
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * 对比两段文本，返回编辑脚本。
 * @param {string} before
 * @param {string} after
 * @returns {{type: 'same'|'add'|'del', text: string, beforeLine: number|null, afterLine: number|null}[]}
 */
export function diffLines(before, after) {
  const a = toLines(before);
  const b = toLines(after);

  if (a.length * b.length > MAX_CELLS) {
    // 退化路径：整段删除 + 整段新增，并显式标记，便于上层提示
    const out = [];
    a.forEach((text, i) => out.push({ type: 'del', text, beforeLine: i + 1, afterLine: null }));
    b.forEach((text, i) => out.push({ type: 'add', text, beforeLine: null, afterLine: i + 1 }));
    return out;
  }

  const n = a.length;
  const m = b.length;
  // (n+1) x (m+1) 的 LCS 长度表，用一维 Uint32Array 摊平
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i], beforeLine: i + 1, afterLine: j + 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      out.push({ type: 'del', text: a[i], beforeLine: i + 1, afterLine: null });
      i++;
    } else {
      out.push({ type: 'add', text: b[j], beforeLine: null, afterLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i], beforeLine: i + 1, afterLine: null });
    i++;
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j], beforeLine: null, afterLine: j + 1 });
    j++;
  }
  return out;
}

/**
 * 汇总差异规模。
 * @param {ReturnType<typeof diffLines>} diff
 */
export function summarize(diff) {
  let added = 0;
  let removed = 0;
  let same = 0;
  for (const row of diff) {
    if (row.type === 'add') added++;
    else if (row.type === 'del') removed++;
    else same++;
  }
  const total = added + removed + same;
  // 相似度用 Dice 系数：2*same/(行数A+行数B)。
  // 早期用 same/total（total 含增删）会把「4 行改 1 行」算成 0.6，严重低估实际相同程度。
  const nA = same + removed;
  const nB = same + added;
  return {
    added,
    removed,
    same,
    total,
    similarity: nA + nB === 0 ? 1 : (2 * same) / (nA + nB),
    identical: added === 0 && removed === 0,
  };
}
