import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVariables, render, templateStats, VAR_NAME_RE } from '../src/core/template.js';

test('parseVariables 提取变量并去重，保持首次出现顺序', () => {
  const vars = parseVariables('你好 {{name}}，你的{{role}}是{{name}}，还有 {{ a.b }} 和 {{c-d}}');
  assert.deepEqual(vars, ['name', 'role', 'a.b', 'c-d']);
});

test('parseVariables 对无变量文本返回空数组', () => {
  assert.deepEqual(parseVariables('纯文本，没有任何占位符'), []);
});

test('parseVariables 忽略不合法占位符', () => {
  // {{ }} 空、{{x y}} 带空格分隔两个词、{{a+b}} 含非法符号
  assert.deepEqual(parseVariables('{{}} {{x y}} {{a+b}}'), []);
});

test('render 替换全部变量并报告未使用值', () => {
  const r = render('你好 {{name}}，{{greeting}}', { name: '张三', greeting: '早安', extra: 'x' });
  assert.equal(r.output, '你好 张三，早安');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.used.sort(), ['greeting', 'name']);
  assert.deepEqual(r.unused, ['extra']);
});

test('render 缺失变量保留原占位符并记入 missing（不静默填空字符串）', () => {
  const r = render('A{{missing}}B', {});
  assert.equal(r.output, 'A{{missing}}B');
  assert.deepEqual(r.missing, ['missing']);
  // used 是「模板里出现的变量」，缺失变量也算出现，所以这里是 ['missing'] 而非 []
  assert.deepEqual(r.used, ['missing']);
  assert.deepEqual(r.unused, []);
});

test('render 把空字符串视为有效值而非缺失', () => {
  const r = render('[{{x}}]', { x: '' });
  assert.equal(r.output, '[]');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.used, ['x']);
});

test('render 把数字 0 视为有效值（常见 falsy 陷阱）', () => {
  const r = render('n={{n}}', { n: 0 });
  assert.equal(r.output, 'n=0');
  assert.deepEqual(r.missing, []);
});

test('render 转义美元符号，避免替换值里的 $& 被当作替换模式', () => {
  const r = render('{{x}}', { x: 'cost $& more' });
  assert.equal(r.output, 'cost $& more');
});

test('render 对同类变量多次出现全部替换', () => {
  const r = render('{{a}}-{{a}}-{{a}}', { a: 'z' });
  assert.equal(r.output, 'z-z-z');
});

test('render 处理 null/undefined 输入不抛异常', () => {
  const r = render(null, null);
  assert.equal(r.output, '');
  assert.deepEqual(r.missing, []);
});

test('templateStats 统计字符、行数与变量数', () => {
  const s = templateStats('a {{x}}\nb {{y}}');
  assert.equal(s.chars, 'a {{x}}\nb {{y}}'.length);
  assert.equal(s.lines, 2);
  assert.equal(s.variables, 2);
});

test('templateStats 空文本返回 0 行', () => {
  const s = templateStats('');
  assert.equal(s.chars, 0);
  assert.equal(s.lines, 0);
  assert.equal(s.variables, 0);
});

test('VAR_NAME_RE 校验单个变量名，不是占位符模式（无全局标志以免 lastIndex 污染）', () => {
  assert.equal(VAR_NAME_RE.global, false);
  assert.equal(VAR_NAME_RE.test('a.b-c_1'), true);
  assert.equal(VAR_NAME_RE.test('x y'), false);
  assert.equal(VAR_NAME_RE.test('a+b'), false);
  assert.equal(VAR_NAME_RE.test('{{a}}'), false, '占位符整体不是合法变量名');
});

test('parseVariables 连续调用结果一致（正则状态不泄漏）', () => {
  const first = parseVariables('{{a}} {{b}}');
  const second = parseVariables('{{a}} {{b}}');
  assert.deepEqual(first, second);
  assert.deepEqual(first, ['a', 'b'], '第二行结果不得为空或残缺');
});
