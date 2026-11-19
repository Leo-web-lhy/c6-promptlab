// End-to-end demo: drives the real core modules and writes a reproducible log.
// Run: node scripts/demo.mjs  ->  docs/demo-output.txt
import { writeFile, mkdir } from 'node:fs/promises';
import { render, parseVariables } from '../src/core/template.js';
import { diffLines, summarize } from '../src/core/diff.js';
import { summarizeScores, bootstrapDiffCI, verdictText } from '../src/core/stats.js';
import { emptyState, createPrompt, addVersion, addRun } from '../src/core/store.js';

const out = [];
const say = (s = '') => out.push(s);
const pad = (s, n) => String(s).padEnd(n, ' ');
const num = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

let state = emptyState();
let r = createPrompt(state, '客服回复生成');
state = r.state;
const prompt = state.prompts[0];

const V1 = '你是客服。请回复用户：{{user_msg}}';
const V2 = [
  '你是一名中文电商客服，语气专业、简洁、不油腻。',
  '处理步骤：',
  '1. 复述用户问题要点：{{user_msg}}',
  '2. 只在 {{policy}} 明确的范围内承诺，绝不自行扩大赔付口径',
  '3. 结尾给一个具体的下一步动作（谁、什么时候、做什么）',
  '输出：只输出回复正文，不要解释你的思路。',
].join('\n');

r = addVersion(state, prompt.id, V1, 'v1 基线：单句指令');
state = r.state;
const ver1 = r.version;

r = addVersion(state, prompt.id, V2, 'v2 结构化：角色+步骤+禁止项');
state = r.state;
const ver2 = r.version;

// 固定序列回放，目的是验证「记录 -> 统计 -> 判定」整条链路，不代表真实模型评分。
const SEQ_A = [2, 3, 2, 3, 3, 2, 3, 2];
const SEQ_B = [4, 5, 4, 4, 5, 4, 4, 5];
const NOTE_A = '基线回放';
const NOTE_B = '结构版回放';

SEQ_A.forEach((score, i) => {
  r = addRun(state, prompt.id, { versionId: ver1.id, values: { user_msg: `样例问题 ${i + 1}` }, output: '(略)', score, note: NOTE_A });
  state = r.state;
});
SEQ_B.forEach((score, i) => {
  r = addRun(state, prompt.id, { versionId: ver2.id, values: { user_msg: `样例问题 ${i + 1}` }, output: '(略)', score, note: NOTE_B });
  state = r.state;
});

const s1 = summarizeScores(SEQ_A);
const s2 = summarizeScores(SEQ_B);
const ci = bootstrapDiffCI(SEQ_A, SEQ_B, { iterations: 4000, seed: 20261119 });

say('PromptLab 端到端演示记录（真实执行，可复现）');
say('生成方式：node scripts/demo.mjs');
say('');
say('[1] 版本');
say(`  提示词: ${prompt.name}`);
say(`  v${ver1.n} 正文 ${ver1.body.length} 字符 / ${ver1.body.split('\n').length} 行 / 变量 ${parseVariables(ver1.body).join(', ') || '无'}`);
say(`  v${ver2.n} 正文 ${ver2.body.length} 字符 / ${ver2.body.split('\n').length} 行 / 变量 ${parseVariables(ver2.body).join(', ') || '无'}`);
say('');
say('[2] 运行记录');
say(`  v${ver1.n}: ${SEQ_A.length} 条  -> ${SEQ_A.join(', ')}`);
say(`  v${ver2.n}: ${SEQ_B.length} 条  -> ${SEQ_B.join(', ')}`);
say('');
say('[3] 描述统计');
say(`  ${pad('版本', 6)}${pad('n', 4)}${pad('mean', 9)}${pad('sd', 9)}${pad('min', 5)}max`);
say(`  ${pad('v' + ver1.n, 6)}${pad(s1.n, 4)}${pad(num(s1.mean), 9)}${pad(num(s1.sd), 9)}${pad(s1.min, 5)}${s1.max}`);
say(`  ${pad('v' + ver2.n, 6)}${pad(s2.n, 4)}${pad(num(s2.mean), 9)}${pad(num(s2.sd), 9)}${pad(s2.min, 5)}${s2.max}`);
say('');
say('[4] 显著性（成对百分位 bootstrap）');
say(`  Δ = mean(B) - mean(A) = ${num(ci.diff)}`);
say(`  95% CI = [${num(ci.low)}, ${num(ci.high)}]  (${ci.iterations} 次重采样, seed 20261119)`);
say(`  结论: ${verdictText(ci)}`);
say(`  significant = ${ci.significant}`);
say('');
say('[5] 正文差异');
const diff = diffLines(ver1.body, ver2.body);
const ds = summarize(diff);
say(`  +${ds.added} 行 / -${ds.removed} 行 / 相同 ${ds.same} 行 / 相似度 ${num(ds.similarity)}`);
say('  逐行：');
for (const row of diff) {
  const mark = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
  const text = row.text.length > 90 ? row.text.slice(0, 90) + '...' : row.text;
  say(`  ${mark} ${text}`);
}
say('');
say('[6] 渲染与缺失变量');
const full = render(ver2.body, { user_msg: '快递三天没动', policy: '7 天无理由退货，运费商家承担' });
say(`  全部变量已给: output 长度 ${full.output.length}, missing=${JSON.stringify(full.missing)}`);
const partial = render(ver2.body, { user_msg: '快递三天没动' });
say(`  缺少 policy: output 保留占位符=${partial.output.includes('{{policy}}')}, missing=${JSON.stringify(partial.missing)}`);
say('');
say('[7] 断言');
const checks = [
  ['两版本变量都被解析出来', parseVariables(ver2.body).length === 2],
  ['结构版均值高于基线', s2.mean > s1.mean],
  ['置信区间下界为正', ci.low > 0],
  ['判定为显著', ci.significant === true],
  ['差异统计自洽（same+added=新行数）', ds.same + ds.added === ver2.body.split('\n').length],
  ['缺失变量如实报告', partial.missing.length === 1 && partial.missing[0] === 'policy'],
  ['不缺失时不误报', full.missing.length === 0],
];
let pass = 0;
for (const [name, ok] of checks) {
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) pass += 1;
}
say('');
say(`结果: ${pass}/${checks.length} 通过`);

await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/demo-output.txt', import.meta.url), out.join('\n') + '\n', 'utf-8');

console.log(`DEMO_OK checks=${pass}/${checks.length} lines=${out.length} chars=${out.join('\n').length}`);
if (pass !== checks.length) process.exitCode = 1;
