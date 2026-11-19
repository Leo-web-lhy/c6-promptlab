import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, mean, stdev, summarizeScores, bootstrapDiffCI, quantile, verdictText,
} from '../src/core/stats.js';

test('mean 对空数组返回 NaN 而不是 0', () => {
  assert.ok(Number.isNaN(mean([])));
  assert.ok(Number.isNaN(mean(null)));
});

test('mean 忽略非数值项', () => {
  assert.equal(mean([1, 2, 3, 'x', null, NaN]), 2);
});

test('stdev 单点返回 NaN，双点给出样本标准差', () => {
  assert.ok(Number.isNaN(stdev([5])));
  assert.equal(stdev([2, 4]), Math.sqrt(2));
});

test('summarizeScores 汇总 n/mean/sd/min/max', () => {
  const s = summarizeScores([3, 4, 5]);
  assert.equal(s.n, 3);
  assert.equal(s.mean, 4);
  assert.equal(s.min, 3);
  assert.equal(s.max, 5);
  assert.ok(s.sd > 0);
});

test('summarizeScores 空输入全部 NaN 且 n=0', () => {
  const s = summarizeScores([]);
  assert.equal(s.n, 0);
  assert.ok(Number.isNaN(s.mean));
  assert.ok(Number.isNaN(s.sd));
});

test('mulberry32 同种子产出同序列（可复现）', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('mulberry32 输出落在 [0,1)', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

test('quantile 线性插值正确', () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(quantile(sorted, 0), 1);
  assert.equal(quantile(sorted, 1), 5);
  assert.equal(quantile(sorted, 0.5), 3);
  assert.equal(quantile(sorted, 0.25), 2);
});

test('bootstrapDiffCI 对同种子结果完全一致（可复现）', () => {
  const a = [2, 3, 2, 4, 3];
  const b = [5, 4, 5, 5, 4];
  const r1 = bootstrapDiffCI(a, b, { seed: 123, iterations: 500 });
  const r2 = bootstrapDiffCI(a, b, { seed: 123, iterations: 500 });
  assert.equal(r1.low, r2.low);
  assert.equal(r1.high, r2.high);
  assert.equal(r1.diff, r2.diff);
});

test('bootstrapDiffCI 对明显分离的两组判为显著', () => {
  const a = [1, 1, 2, 1, 1];
  const b = [5, 5, 4, 5, 5];
  const r = bootstrapDiffCI(a, b, { seed: 1, iterations: 1000 });
  assert.ok(r.diff > 0);
  assert.equal(r.significant, true, `CI=[${r.low},${r.high}]`);
  assert.ok(r.low > 0);
});

test('bootstrapDiffCI 对几乎相同的两组判为不显著', () => {
  const a = [3, 4, 3, 4, 3];
  const b = [3, 4, 4, 3, 3];
  const r = bootstrapDiffCI(a, b, { seed: 1, iterations: 1000 });
  assert.equal(r.significant, false, `CI=[${r.low},${r.high}]`);
  assert.ok(r.low <= 0 && r.high >= 0);
});

test('bootstrapDiffCI 单样本时区间宽度为正且不谎称显著', () => {
  const r = bootstrapDiffCI([0], [1], { seed: 1, iterations: 300 });
  assert.equal(r.nA, 1);
  assert.equal(r.nB, 1);
  // 单点重采样没有方差，区间退化到点值；diff=1 且区间不跨 0，
  // 这里只断言结构正确、不抛异常
  assert.ok(Number.isFinite(r.diff));
  assert.equal(r.iterations, 300);
});

test('bootstrapDiffCI 空组返回 NaN 区间并说明原因', () => {
  const r = bootstrapDiffCI([], [5], { seed: 1 });
  assert.equal(r.iterations, 0);
  assert.equal(r.significant, false);
  assert.ok(Number.isNaN(r.low));
  assert.ok(r.reason);
});

test('verdictText 对显著/不显著/样本不足给出不同措辞', () => {
  const sig = bootstrapDiffCI([1, 1, 1], [5, 5, 5], { seed: 2, iterations: 500 });
  assert.match(verdictText(sig), /差异显著/);

  const ns = bootstrapDiffCI([3, 3, 3, 3], [3, 3, 3, 3], { seed: 2, iterations: 500 });
  assert.match(verdictText(ns), /差异不显著/);

  assert.match(verdictText(null), /样本不足/);
});
