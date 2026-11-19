/**
 * stats.js — 评分统计与 A/B 显著性判断（纯函数，无 DOM 依赖）
 *
 * 为什么需要它：提示词 A/B 最常见的方法是「各跑 3 次，谁均值高用谁」，
 * 但 3 个样本的均值差几乎都在噪声里。这里用 bootstrap 重采样给出
 * 均值差的 95% 置信区间，区间跨 0 就诚实地说「还看不出差别」。
 *
 * 可复现性：伪随机数使用调用方传入的种子（mulberry32），
 * 同样的输入永远给出同样的置信区间，便于他人复核。
 */

/** 确定性伪随机数发生器（32 位状态） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 算术平均。空数组返回 NaN，而不是 0——0 会被误读成「平均得分为 0」。
 * @param {number[]} xs
 */
export function mean(xs) {
  const arr = clean(xs);
  if (arr.length === 0) return NaN;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

/**
 * 样本标准差（n-1）。n < 2 时返回 NaN（单点没有离散度可言）。
 * @param {number[]} xs
 */
export function stdev(xs) {
  const arr = clean(xs);
  if (arr.length < 2) return NaN;
  const mu = mean(arr);
  const ss = arr.reduce((s, x) => s + (x - mu) * (x - mu), 0);
  return Math.sqrt(ss / (arr.length - 1));
}

function clean(xs) {
  if (!Array.isArray(xs)) return [];
  return xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
}

/**
 * 汇总一组评分。
 * @param {number[]} scores
 */
export function summarizeScores(scores) {
  const arr = clean(scores);
  if (arr.length === 0) {
    return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN, se: NaN };
  }
  const mu = mean(arr);
  const sd = stdev(arr);
  return {
    n: arr.length,
    mean: mu,
    sd,
    min: Math.min(...arr),
    max: Math.max(...arr),
    se: arr.length > 1 ? sd / Math.sqrt(arr.length) : NaN,
  };
}

/**
 * 对两组样本做 bootstrap 重采样，估计均值差的置信区间。
 * @param {number[]} a 对照组
 * @param {number[]} b 实验组
 * @param {{iterations?: number, seed?: number, confidence?: number}} [opts]
 * @returns {{
 *   meanA: number, meanB: number, diff: number, low: number, high: number,
 *   confidence: number, iterations: number, significant: boolean,
 *   nA: number, nB: number, method: string
 * }}
 */
export function bootstrapDiffCI(a, b, opts) {
  const o = opts || {};
  const iterations = Number.isFinite(o.iterations) ? Math.max(200, o.iterations) : 4000;
  const seed = Number.isFinite(o.seed) ? o.seed : 20261119;
  const confidence = Number.isFinite(o.confidence) ? o.confidence : 0.95;

  const A = clean(a);
  const B = clean(b);
  const meanA = mean(A);
  const meanB = mean(B);
  const diff = meanB - meanA;

  if (A.length === 0 || B.length === 0) {
    return {
      meanA, meanB, diff, low: NaN, high: NaN, confidence,
      iterations: 0, significant: false, nA: A.length, nB: B.length,
      method: 'bootstrap-percentile',
      reason: 'need at least one score in each version',
    };
  }

  const rnd = mulberry32(seed);
  const diffs = new Float64Array(iterations);
  for (let k = 0; k < iterations; k++) {
    let sa = 0;
    for (let i = 0; i < A.length; i++) sa += A[Math.floor(rnd() * A.length)];
    let sb = 0;
    for (let i = 0; i < B.length; i++) sb += B[Math.floor(rnd() * B.length)];
    diffs[k] = sb / B.length - sa / A.length;
  }

  const sorted = Array.from(diffs).sort((x, y) => x - y);
  const alpha = (1 - confidence) / 2;
  const low = quantile(sorted, alpha);
  const high = quantile(sorted, 1 - alpha);
  // 区间不跨 0 才说「有差别」
  const significant = low > 0 || high < 0;

  return {
    meanA, meanB, diff, low, high, confidence, iterations,
    significant, nA: A.length, nB: B.length,
    method: 'bootstrap-percentile',
  };
}

/** 线性插值分位数（输入需已升序） */
export function quantile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** 把 95% 区间翻译成一句人话结论 */
export function verdictText(ci) {
  if (!ci || !Number.isFinite(ci.low)) {
    return '样本不足，无法判断（两组各至少需要 1 条评分）';
  }
  const pct = Math.round(ci.confidence * 100);
  const span = `[${ci.low.toFixed(3)}, ${ci.high.toFixed(3)}]`;
  if (ci.significant) {
    const better = ci.diff > 0 ? 'B' : 'A';
    return `差异显著：${better} 组更高（${pct}% 区间 ${span}，未跨 0）`;
  }
  return `差异不显著：${pct}% 区间 ${span} 跨 0，样本量 ${ci.nA}/${ci.nB} 下无法区分`;
}
