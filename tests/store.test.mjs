import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, createPrompt, addVersion, addRun, removePrompt, removeRun,
  scoresOfVersion, searchPrompts, validateImport, SCHEMA_VERSION,
} from '../src/core/store.js';

function seed() {
  let s = emptyState();
  const r1 = createPrompt(s, '客服回复', 1000);
  s = r1.state;
  const pid = r1.prompt.id;
  const v1 = addVersion(s, pid, '你好 {{name}}', '初版', 1001);
  s = v1.state;
  const v2 = addVersion(s, pid, '你好 {{name}}，需要我帮你处理 {{topic}} 吗？', '补充追问', 1002);
  s = v2.state;
  return { state: s, pid, v1: v1.version.id, v2: v2.version.id };
}

test('emptyState 结构正确且 schemaVersion 匹配', () => {
  const s = emptyState();
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(s.prompts, []);
  assert.equal(s.settings.activePromptId, null);
});

test('createPrompt 生成提示词并设为 active', () => {
  const { state, pid } = seed();
  assert.equal(state.prompts.length, 1);
  assert.equal(state.settings.activePromptId, pid);
  assert.equal(state.createdAt, 1000);
});

test('createPrompt 对空名给出兜底名而不是空字符串', () => {
  const { state } = createPrompt(emptyState(), '   ', 1);
  assert.equal(state.prompts[0].name, '未命名提示词');
});

test('addVersion 版本号连续递增', () => {
  const { state } = seed();
  const vs = state.prompts[0].versions;
  assert.deepEqual(vs.map((v) => v.n), [1, 2]);
});

test('addVersion 拒绝空正文', () => {
  const { state, pid } = seed();
  assert.throws(() => addVersion(state, pid, '   '), /不能为空/);
});

test('addVersion 拒绝与上一版完全相同的正文（不制造空版本）', () => {
  const { state, pid } = seed();
  const last = state.prompts[0].versions[1].body;
  assert.throws(() => addVersion(state, pid, last), /完全相同/);
});

test('addVersion 不修改原状态对象（不可变更新）', () => {
  const { state, pid } = seed();
  const before = state.prompts[0].versions.length;
  addVersion(state, pid, '第三版内容', 'x', 1003);
  assert.equal(state.prompts[0].versions.length, before, '原 state 必须保持不变');
});

test('addVersion 对不存在的提示词抛错', () => {
  const { state } = seed();
  assert.throws(() => addVersion(state, 'nope', 'x'), /prompt not found/);
});

test('addRun 记录评分并关联版本', () => {
  const { state, pid, v2 } = seed();
  const r = addRun(state, pid, { versionId: v2, values: { name: 'A' }, output: 'out', score: 4, note: '好' }, 1004);
  assert.equal(r.run.score, 4);
  assert.equal(r.state.prompts[0].runs.length, 1);
});

test('addRun 拒绝越界评分（0 与 6）', () => {
  const { state, pid, v1 } = seed();
  assert.throws(() => addRun(state, pid, { versionId: v1, score: 0 }), /1..5/);
  assert.throws(() => addRun(state, pid, { versionId: v1, score: 6 }), /1..5/);
});

test('addRun 拒绝指向不存在版本的记录', () => {
  const { state, pid } = seed();
  assert.throws(() => addRun(state, pid, { versionId: 'ghost', score: 3 }), /version not found/);
});

test('scoresOfVersion 只返回该版本评分', () => {
  const { state: s0, pid, v1, v2 } = seed();
  let state = addRun(s0, pid, { versionId: v1, score: 3 }).state;
  state = addRun(state, pid, { versionId: v2, score: 5 }).state;
  state = addRun(state, pid, { versionId: v2, score: 4 }).state;
  assert.deepEqual(scoresOfVersion(state.prompts[0], v1), [3]);
  assert.deepEqual(scoresOfVersion(state.prompts[0], v2), [5, 4]);
});

test('removeRun 只删指定记录', () => {
  const { state: s0, pid, v1 } = seed();
  const added = addRun(s0, pid, { versionId: v1, score: 3 });
  const state = removeRun(added.state, pid, added.run.id);
  assert.equal(state.prompts[0].runs.length, 0);
});

test('removePrompt 删除后 activePromptId 回退到剩余项或 null', () => {
  const { state: s0, pid } = seed();
  const s1 = removePrompt(s0, pid);
  assert.equal(s1.prompts.length, 0);
  assert.equal(s1.settings.activePromptId, null);

  const multi = createPrompt(s0, '第二个', 2000);
  const s2 = removePrompt(multi.state, pid);
  assert.equal(s2.prompts.length, 1);
  assert.equal(s2.settings.activePromptId, multi.prompt.id);
});

test('searchPrompts 命中名称、正文与备注，空关键词返回全部', () => {
  const { state } = seed();
  assert.equal(searchPrompts(state, '').length, 1);
  assert.equal(searchPrompts(state, '客服').length, 1);
  assert.equal(searchPrompts(state, 'topic').length, 1, '应能命中版本正文');
  assert.equal(searchPrompts(state, '不存在的词').length, 0);
});

test('validateImport 接受合法 JSON 字符串并给出统计', () => {
  const { state } = seed();
  const r = validateImport(JSON.stringify(state));
  assert.equal(r.ok, true);
  assert.deepEqual(r.stats, { prompts: 1, versions: 2, runs: 0 });
});

test('validateImport 拒绝损坏 JSON', () => {
  const r = validateImport('{not json');
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

test('validateImport 拒绝缺少 prompts 数组', () => {
  const r = validateImport('{"schemaVersion":2}');
  assert.equal(r.ok, false);
  assert.match(r.error, /prompts/);
});

test('validateImport 拒绝指向不存在版本的运行记录', () => {
  const bad = {
    prompts: [{
      id: 'p1', name: 'x', versions: [{ id: 'v1', body: 'a' }],
      runs: [{ id: 'r1', versionId: 'vX', score: 3 }],
    }],
  };
  const r = validateImport(JSON.stringify(bad));
  assert.equal(r.ok, false);
  assert.match(r.error, /不存在的版本/);
});

test('validateImport 拒绝越界评分', () => {
  const bad = {
    prompts: [{
      id: 'p1', name: 'x', versions: [{ id: 'v1', body: 'a' }],
      runs: [{ id: 'r1', versionId: 'v1', score: 9 }],
    }],
  };
  assert.equal(validateImport(JSON.stringify(bad)).ok, false);
});

test('validateImport 兼容缺少可选字段的旧存档（补默认值）', () => {
  const legacy = { prompts: [{ id: 'p1', name: 'old', versions: [{ id: 'v1', body: 'a' }], runs: [] }] };
  const r = validateImport(JSON.stringify(legacy));
  assert.equal(r.ok, true);
  const p = r.state.prompts[0];
  assert.equal(p.versions[0].n, 1);
  assert.equal(p.versions[0].note, '');
  assert.equal(r.state.schemaVersion, SCHEMA_VERSION);
});
