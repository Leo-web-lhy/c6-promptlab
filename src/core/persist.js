/**
 * persist.js — 持久化适配层（唯一接触浏览器存储的模块）
 *
 * 三种后端，按可用性降级：
 *   localStorage  正常浏览器
 *   memory        localStorage 被禁用（隐私模式 / 配额耗尽 / 沙箱 iframe）
 *
 * 降级不是静默失败：调用方可通过 backend() 读到当前实际后端并在 UI 上告知用户，
 * 否则用户会以为「保存成功」而刷新后数据消失。
 */

import { emptyState, validateImport, SCHEMA_VERSION } from './store.js';

const KEY = 'promptlab.state.v2';
const BACKUP_KEY = 'promptlab.state.v2.backup';

let memoryState = null;
let memoryBackend = false;

/** 探测 localStorage 是否真的可写（有的环境存在对象但写入抛异常） */
function probeLocalStorage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    const probeKey = '__promptlab_probe__';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return true;
  } catch (e) {
    return false;
  }
}

export function backend() {
  if (memoryBackend) return 'memory';
  return probeLocalStorage() ? 'localStorage' : 'memory';
}

/** 读取状态；任何异常都退回空状态，但保留原始串到备份键，避免用户数据被覆盖丢失 */
export function load() {
  if (!probeLocalStorage()) {
    memoryBackend = true;
    return { state: memoryState || emptyState(), backend: 'memory', warning: '浏览器存储不可用，本次数据仅保存在内存中' };
  }
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    memoryBackend = true;
    return { state: memoryState || emptyState(), backend: 'memory', warning: '读取存储失败：' + e.message };
  }
  if (!raw) return { state: emptyState(), backend: 'localStorage' };

  const result = validateImport(raw);
  if (result.ok) {
    return { state: result.state, backend: 'localStorage' };
  }
  // 存档损坏：先备份原文再返回空状态，给用户一次手工抢救的机会
  try {
    localStorage.setItem(BACKUP_KEY, raw);
  } catch (e) {
    /* 备份失败也不阻断启动 */
  }
  return {
    state: emptyState(),
    backend: 'localStorage',
    warning: `本地存档无法解析（${result.error}），已备份原文到 ${BACKUP_KEY} 并以空状态启动`,
  };
}

/** 写入状态 */
export function save(state) {
  const payload = JSON.stringify(Object.assign({}, state, { schemaVersion: SCHEMA_VERSION }));
  if (!probeLocalStorage()) {
    memoryBackend = true;
    memoryState = state;
    return { ok: true, backend: 'memory' };
  }
  try {
    localStorage.setItem(KEY, payload);
    memoryBackend = false;
    return { ok: true, backend: 'localStorage', bytes: payload.length };
  } catch (e) {
    // 配额耗尽：降级到内存，并明确报告，不假装成功
    memoryBackend = true;
    memoryState = state;
    return { ok: false, backend: 'memory', error: '写入失败（可能超出配额）：' + e.message };
  }
}

/** 导出为可下载字符串 */
export function exportJson(state) {
  return JSON.stringify(Object.assign({}, state, { schemaVersion: SCHEMA_VERSION }), null, 2);
}

/** 导入（复用 store 的校验，不重复写规则） */
export function importJson(text) {
  return validateImport(text);
}

/** 清空存储（用户显式操作时才调用） */
export function clearAll() {
  memoryState = null;
  if (!probeLocalStorage()) return { ok: true, backend: 'memory' };
  try {
    localStorage.removeItem(KEY);
    return { ok: true, backend: 'localStorage' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const STORAGE_KEY = KEY;
