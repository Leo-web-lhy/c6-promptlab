# PromptLab · 提示词 A/B 工作台

一个**本地优先**的提示词版本管理与 A/B 显著性检验工具。改提示词时最常见的两个动作是「存一版」和「这次比上次好多少」，但大多数人靠感觉判断。PromptLab 把这两件事变成可复算的记录：每个版本留快照、每次运行留评分、比较时给**置信区间**而不是直接给结论。

- 在线使用：<https://leo-web-lhy.github.io/c6-promptlab/>
- 源码仓库：<https://github.com/Leo-web-lhy/c6-promptlab>
- 无需注册、无需后端：数据只存在你自己的浏览器 `localStorage`，可随时导出成 JSON 带走。

## 它解决什么

| 常见做法 | 问题 | PromptLab 的做法 |
|---|---|---|
| 提示词改完直接覆盖 | 改坏了回不去，也说不清哪一版更好 | 每次保存生成不可变版本快照，带备注 |
| 比较两版时看均值 | 3 次 5 分 vs 3 次 4.5 分就下结论，噪声当信号 | 百分位 bootstrap 给出 Δ 的 95% 置信区间，区间跨 0 就明确说「分不出差别」 |
| 差异靠肉眼比对 | 长提示词里改了一个词根本看不出来 | 行级 LCS diff，标出新增/删除行与相似度 |
| 记录散在聊天和便签里 | 换设备就丢，无法交接 | 一键导出/导入 JSON，带 schema 版本校验 |

## 功能

1. **提示词与版本**：新建、改名、删除；每版保存正文 + 备注；`{{变量}}` 自动识别并展示。
2. **运行记录**：填变量值 → 渲染 → 打 1–5 分 + 备注存档；记录按版本归属，支持逐条删除。
3. **A/B 对比**：任选两版，给出两组描述统计、Δ 与 95% CI、显著性判定文字，同时并列正文 diff。
4. **数据自持**：导出 JSON、导入 JSON（含结构校验，坏数据拒绝写入）、清空全部。
5. **离线可用**：注册 Service Worker，断网仍能打开应用外壳。
6. **浏览器内自检**：不装环境、不开终端，点「自检」按钮就跑 11 条断言。

## 快速开始

```bash
# 需要 Node >= 18，零依赖
npm test            # 单元测试（61 条）
npm run demo        # 端到端脚本，输出 docs/demo-output.txt
npm run serve       # http://localhost:8080
```

或者直接双击 `index.html`——所有模块用原生 ESM，不需要打包。`file://` 下 Service Worker 不注册、导入导出仍可用。

## 目录结构

```
index.html              应用外壳（4 个面板：编辑 / 运行 / 对比 / 存档）
manifest.webmanifest    PWA 清单
sw.js                   Service Worker（外壳缓存，网络优先）
icon.svg
src/core/template.js    {{变量}} 解析与渲染
src/core/diff.js        行级 LCS diff 与相似度
src/core/stats.js       均值/样本标准差/百分位 bootstrap CI
src/core/store.js       实体与纯函数状态迁移（不可变返回）
src/core/persist.js     localStorage 读写、导入校验、导出
src/ui/app.js           视图与事件绑定
src/ui/styles.css       深色主题样式
tests/*.test.mjs        node:test 单元测试
scripts/serve.mjs       零依赖静态服务器
scripts/demo.mjs        端到端演示（真实驱动核心模块）
docs/demo-output.txt    演示运行的真实输出
```

## 数据模型

```jsonc
{
  "schemaVersion": 2,
  "prompts": [{
    "id": "p_...", "name": "客服回复生成",
    "versions": [{ "id": "v_...", "n": 1, "body": "...", "note": "...", "createdAt": 0 }],
    "runs": [{ "id": "r_...", "versionId": "v_...", "values": {}, "output": "...", "score": 4, "note": "...", "createdAt": 0 }]
  }],
  "settings": { "theme": "dark", "activePromptId": "p_..." },
  "createdAt": 0, "updatedAt": 0
}
```

状态迁移全部是纯函数（`store.js`），返回新对象而不是就地修改——这样「保存一版」不会悄悄改掉旧版，也方便测试。

## 统计方法与其边界

- `mean` / `sd`：`sd` 用**样本标准差**（n−1），因为把几次运行当成抽样而非全体。
- `bootstrapDiffCI`：对两组的差值分布做**百分位 bootstrap**（默认 4000 次重采样，固定 seed 保证同输入同输出），报告 95% 区间与 `significant = (low > 0 || high < 0)`。
- **明确的局限**：n 很小时区间会非常宽，这不是 bug 而是事实——4 条记录判不出 0.5 分差距。工具的价值是阻止你在这时候下结论，而不是替你造结论。

## 测试与验证记录

- 单元测试：`61 passed / 0 failed`（`node --test tests/*.mjs`，约 212ms）。
- 本地 HTTP 冒烟：`/`、`/index.html`、`/src/ui/app.js`、`/src/ui/styles.css`、`/sw.js`、`/manifest.webmanifest`、`/src/core/store.js`、`/icon.svg` 全部 `200`。
- 端到端演示：`node scripts/demo.mjs` → `DEMO_OK checks=7/7`，输出见 `docs/demo-output.txt`（含两版正文 diff、Δ 与置信区间）。

## 已知边界

- 评分是人工打的主观分，工具只负责统计，不负责替你判断「什么算好」。
- 数据在浏览器本地，换浏览器/清缓存即丢；跨设备请用导出 JSON。
- 没有多用户协作，也没有云端同步——这是刻意的设计取舍（无后端 = 无隐私外泄面）。
- 单个提示词的版本/运行记录未做虚拟滚动，超大数量（数千条）下渲染会变慢。
