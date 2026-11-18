/**
 * 适配补丁包（adapter packs）：内置补丁表的版本兼容层。
 *
 * 为什么需要：内置补丁用「整段原文」当 needle，官方改一次函数形态、字段顺序、
 * 包名，就整片变 skipped。补丁表本身不适合为每个版本各写一份，于是把「按新版
 * 源码重写过的 needle」抽成外部数据包，按宿主版本加载。
 *
 * 位置：$DSH_HOME/dsh-purge/patches.d/*.json
 * 结构：
 *   {
 *     "name": "0.2.2-rc.1 adapter pack",
 *     "hosts": ["0.2.2-rc.1"],          // 为空/缺省 = 所有版本
 *     "edits": [
 *       {
 *         "id": 62,                      // 对应内置补丁编号（用于登记 adapted 台账）
 *         "file": "dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js",
 *         "find": "…原文…",              // 字符串，或正则源
 *         "regex": true,                 // true 时 find 按正则编译（支持 $1 反向引用）
 *         "replace": "…替换…",
 *         "expect": 1,                   // 期望命中次数，不等于就不动手（默认 1）
 *         "marker": "[dsh-purge]"        // 打完后文件里应出现的标记（可省）
 *       }
 *     ]
 *   }
 *
 * 应用规则：命中次数必须等于 expect 才写；已有 marker（说明打过了）直接跳过；
 * 任一 edit 失败不影响其他 edit。全部 edit 成功的 id 自动登记进 adapted 台账。
 */
import fs from "node:fs";
import path from "node:path";
import * as adaptedLedger from "./adapted.js";
import { openAsar, findOriginalArchive } from "./asar-read.js";

const DIR_NAME = "patches.d";

export function adaptersDir(dshHome) {
  return path.join(dshHome || process.env.DSH_HOME || ".", "dsh-purge", DIR_NAME);
}

function versionMatches(want, hostVersion) {
  const list = (Array.isArray(want) ? want : want ? [want] : []).map(String).filter(Boolean);
  if (list.length === 0) return true; // 未声明 = 通吃
  if (!hostVersion) return true; // 版本未知时不过滤（CLI 早期）
  return list.some((v) => hostVersion === v || hostVersion.startsWith(`${v}-`) || hostVersion.startsWith(v));
}

/** 读取并过滤出适用于当前宿主的补丁包。 */
export function loadPacks(dshHome, hostVersion = "") {
  const dir = adaptersDir(dshHome);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return { dir, packs: [], skipped: [] };
  }
  const packs = [];
  const skipped = [];
  for (const name of names.sort()) {
    const fp = path.join(dir, name);
    try {
      const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
      const pack = {
        name: String(raw.name || name),
        hosts: raw.hosts || [],
        source: fp,
        edits: Array.isArray(raw.edits) ? raw.edits : [],
      };
      if (!versionMatches(pack.hosts, hostVersion)) {
        skipped.push({ name: pack.name, source: fp, hosts: pack.hosts });
        continue;
      }
      packs.push(pack);
    } catch (e) {
      skipped.push({ name, source: fp, error: String(e && e.message ? e.message : e) });
    }
  }
  return { dir, packs, skipped };
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

/** 校验：在「原文」上能不能命中（用来确认适配包是照当前宿主版本写的）。 */
export function verifyPacks({ dshHome, appDir, hostVersion = "" }) {
  const { dir, packs, skipped } = loadPacks(dshHome, hostVersion);
  const archive = "";
  const rows = [];
  for (const pack of packs) {
    for (const [i, edit] of pack.edits.entries()) {
      const tag = `${pack.name}#${edit.id ?? i}`;
      const fp = path.join(appDir, edit.file);
      const bak = `${fp}.dshpurge.bak`;
      // 原文优先：官方 asar > .dshpurge.bak > 当前文件
      let text = "";
      let on = "";
      const asarPath = archive || findOriginalArchive(path.dirname(appDir));
      if (asarPath) {
        try {
          const reader = openAsar(asarPath);
          const buf = reader.readFile(edit.file);
          reader.close();
          if (buf) {
            text = buf.toString("utf8");
            on = "asar";
          }
        } catch {
          /* 落到下面 */
        }
      }
      if (!text) {
        const src = fs.existsSync(bak) ? bak : fp;
        if (!fs.existsSync(src)) {
          rows.push({ tag, status: "missing_file", file: edit.file });
          continue;
        }
        text = fs.readFileSync(src, "utf8");
        on = fs.existsSync(bak) ? "bak" : "current";
      }
      if (edit.regex) {
        let re;
        try {
          re = new RegExp(edit.find, "m");
        } catch (e) {
          rows.push({ tag, status: "bad_regex", detail: String(e && e.message ? e.message : e) });
          continue;
        }
        const hit = re.test(text);
        rows.push({ tag, status: hit ? "ok" : "no_match", file: edit.file, on });
        continue;
      }
      const n = countOccurrences(text, edit.find);
      const want = Number(edit.expect ?? 1);
      rows.push({ tag, status: n === want ? "ok" : n === 0 ? "no_match" : "count_mismatch", hits: n, want, file: edit.file });
    }
  }
  return { dir, hostVersion, packs: packs.length, skipped, rows };
}

/**
 * 应用适配包。
 * @returns {{ packs, applied, already, missed, rows, adaptedIds }}
 */
export function applyPacks({ dshHome, appDir, hostVersion = "", dryRun = false }) {
  const { dir, packs, skipped } = loadPacks(dshHome, hostVersion);
  const rows = [];
  let applied = 0;
  let already = 0;
  let missed = 0;
  const perId = new Map(); // id -> { ok: true/false }

  for (const pack of packs) {
    for (const [i, edit] of pack.edits.entries()) {
      const tag = `${pack.name}#${edit.id ?? i}`;
      const id = Number(edit.id);
      const fp = path.join(appDir, edit.file);
      if (!fs.existsSync(fp)) {
        rows.push({ tag, id, status: "missing_file", file: edit.file });
        if (Number.isFinite(id)) perId.set(id, false);
        missed += 1;
        continue;
      }
      let text;
      try {
        text = fs.readFileSync(fp, "utf8");
      } catch (e) {
        rows.push({ tag, id, status: "read_error", detail: String(e && e.message ? e.message : e) });
        if (Number.isFinite(id)) perId.set(id, false);
        continue;
      }
      if (edit.marker && text.includes(edit.marker)) {
        rows.push({ tag, id, status: "already" });
        already += 1;
        if (Number.isFinite(id) && !perId.has(id)) perId.set(id, true);
        continue;
      }

      let next = null;
      if (edit.regex) {
        let re;
        try {
          re = new RegExp(edit.find, "gm");
        } catch (e) {
          rows.push({ tag, id, status: "bad_regex", detail: String(e && e.message ? e.message : e) });
          if (Number.isFinite(id)) perId.set(id, false);
          continue;
        }
        re.lastIndex = 0;
        if (!re.test(text)) {
          if (edit.tolerateMissing) {
            rows.push({ tag, id, status: "already", file: edit.file });
            already += 1;
            if (Number.isFinite(id) && !perId.has(id)) perId.set(id, true);
            continue;
          }
          rows.push({ tag, id, status: "no_match", file: edit.file });
          if (Number.isFinite(id)) perId.set(id, false);
          missed += 1;
          continue;
        }
        re.lastIndex = 0;
        next = text.replace(re, String(edit.replace ?? ""));
      } else {
        const hits = countOccurrences(text, edit.find);
        const want = Number(edit.expect ?? 1);
        if (hits !== want) {
          // 删除型 edit：原文本来就不在就是目标状态
          if (hits === 0 && edit.tolerateMissing) {
            rows.push({ tag, id, status: "already", file: edit.file });
            already += 1;
            if (Number.isFinite(id) && !perId.has(id)) perId.set(id, true);
            continue;
          }
          rows.push({ tag, id, status: hits === 0 ? "no_match" : "count_mismatch", hits, want, file: edit.file });
          if (Number.isFinite(id)) perId.set(id, false);
          missed += 1;
          continue;
        }
        next = text.split(edit.find).join(String(edit.replace ?? ""));
      }
      if (next === text) {
        rows.push({ tag, id, status: "no_change" });
        already += 1;
        if (Number.isFinite(id) && !perId.has(id)) perId.set(id, true);
        continue;
      }
      if (!dryRun) {
        const bak = `${fp}.dshpurge.bak`;
        if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
        fs.writeFileSync(fp, next, "utf8");
      }
      rows.push({ tag, id, status: "applied", file: edit.file });
      applied += 1;
      if (Number.isFinite(id) && !perId.has(id)) perId.set(id, true);
    }
  }

  const adaptedIds = [...perId.entries()].filter(([, ok]) => ok).map(([id]) => id);
  if (!dryRun && adaptedIds.length > 0) {
    try {
      const named = adaptedIds.map((id) => ({ id }));
      adaptedLedger.recordAdapted(dshHome, named, { host: hostVersion, note: "adapter pack" });
    } catch {
      /* 台账写不进去不影响补丁 */
    }
  }
  return { dir, hostVersion, packs: packs.length, skipped, applied, already, missed, rows, adaptedIds };
}
