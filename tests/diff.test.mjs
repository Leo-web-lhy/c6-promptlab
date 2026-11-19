import test from 'node:test';
import assert from 'node:assert/strict';
import { toLines, diffLines, summarize, MAX_CELLS } from '../src/core/diff.js';

test('toLines 按行切分，空文本得空数组', () => {
  assert.deepEqual(toLines('a\nb'), ['a', 'b']);
  assert.deepEqual(toLines(''), []);
  assert.deepEqual(toLines(null), []);
});

test('toLines 保留尾部空行语义（换行结尾不多造一行）', () => {
  assert.deepEqual(toLines('a\n'), ['a']);
  assert.deepEqual(toLines('a\n\n'), ['a', '']);
});

test('diffLines 相同文本全部标记为 same', () => {
  const d = diffLines('a\nb\nc', 'a\nb\nc');
  assert.equal(d.length, 3);
  assert.ok(d.every((x) => x.type === 'same'));
});

test('diffLines 识别单行插入', () => {
  const d = diffLines('a\nc', 'a\nb\nc');
  const adds = d.filter((x) => x.type === 'add');
  assert.equal(adds.length, 1);
  assert.equal(adds[0].text, 'b');
  assert.equal(d.filter((x) => x.type === 'del').length, 0);
});

test('diffLines 识别单行删除', () => {
  const d = diffLines('a\nb\nc', 'a\nc');
  const dels = d.filter((x) => x.type === 'del');
  assert.equal(dels.length, 1);
  assert.equal(dels[0].text, 'b');
});

test('diffLines 识别替换为 一删一增', () => {
  const d = diffLines('hello', 'world');
  assert.equal(d.filter((x) => x.type === 'del').length, 1);
  assert.equal(d.filter((x) => x.type === 'add').length, 1);
});

test('diffLines 对纯新增文本（原为空）全部为 add', () => {
  const d = diffLines('', 'a\nb');
  assert.equal(d.filter((x) => x.type === 'add').length, 2);
  assert.equal(d.filter((x) => x.type === 'same').length, 0);
});

test('diffLines 两侧都为空时返回空脚本', () => {
  assert.deepEqual(diffLines('', ''), []);
});

test('summarize 统计增删改与相似度', () => {
  const s = summarize(diffLines('a\nb\nc\nd', 'a\nB\nc\nd'));
  assert.equal(s.added, 1);
  assert.equal(s.removed, 1);
  assert.equal(s.same, 3);
  assert.equal(s.identical, false);
  assert.ok(s.similarity > 0.6 && s.similarity < 1);
});

test('summarize 对完全相同的文本给出 similarity=1 且 identical=true', () => {
  const s = summarize(diffLines('x\ny', 'x\ny'));
  assert.equal(s.similarity, 1);
  assert.equal(s.identical, true);
  assert.equal(s.added, 0);
  assert.equal(s.removed, 0);
});

test('summarize 对完全不同文本给出 similarity=0', () => {
  const s = summarize(diffLines('a\nb', 'c\nd'));
  assert.equal(s.same, 0);
  assert.equal(s.similarity, 0);
  assert.equal(s.identical, false);
});

test('超阈值输入退化为整体替换而不抛异常', () => {
  // 构造行数使 n*m 超过 MAX_CELLS
  const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
  const left = Array.from({ length: n }, (_, i) => 'L' + i).join('\n');
  const right = Array.from({ length: n }, (_, i) => 'R' + i).join('\n');
  const started = Date.now();
  const d = diffLines(left, right);
  const elapsed = Date.now() - started;
  assert.ok(d.length >= 2, 'should produce a degraded script');
  assert.ok(d.some((x) => x.type === 'del'));
  assert.ok(d.some((x) => x.type === 'add'));
  assert.ok(elapsed < 3000, 'degraded path must not hang, took ' + elapsed + 'ms');
  // 退化路径不应声称有相同行
  assert.equal(d.filter((x) => x.type === 'same').length, 0);
});
