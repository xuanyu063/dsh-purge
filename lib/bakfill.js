/**
 * 补齐 / 校正原文备份（`.dshpurge.bak`）。
 *
 * 规则只有一条：**备份必须与官方 asar 里的原文逐字节一致**。
 *
 * 为什么不能只判"缺不缺 bak"：
 *   - 引擎只在真要改字节时写 bak，从解包目录起手的文件可能压根没 bak；
 *   - 更隐蔽的是"bak 存在但内容不对"——它可能是在已经打过补丁的状态下拍的快照，
 *     也可能来自更早的版本。这种 bak 会让「还原」还原成一个半patch 状态。
 *
 * 所以这里以官方 asar 为唯一原文来源：当前文件带 marker（确实被改过）时，
 * bak 与 asar 原文不一致就覆盖。只写 bak，不动当前文件。
 */
import fs from "node:fs";
import path from "node:path";
import { openAsar, findOriginalArchive } from "./asar-read.js";
import { loadPacks } from "./adapters.js";

const MARKER = "[dsh-purge";

function bakPath(fp) {
  return `${fp}.dshpurge.bak`;
}

function existingBak(fp) {
  for (const cand of [bakPath(fp), `${fp}.dsh-purge.bak`]) {
    if (fs.existsSync(cand)) return cand;
  }
  return "";
}

/**
 * @param {{ resourcesDir: string, appDir: string, files: Record<string,string|string[]>, dryRun?: boolean }} opts
 */
export function fillMissingBackups({ resourcesDir, appDir, files, dryRun = false, dshHome = "", hostVersion = "" }) {
  const result = { archive: "", filled: 0, rebuilt: 0, skipped: 0, missingOriginal: 0, errors: [], entries: [] };
  const archive = findOriginalArchive(resourcesDir);
  if (!archive) {
    result.errors.push(`找不到官方 asar（${resourcesDir}）`);
    return result;
  }
  result.archive = archive;

  let reader;
  try {
    reader = openAsar(archive);
  } catch (e) {
    result.errors.push(`打开 asar 失败: ${String(e && e.message ? e.message : e)}`);
    return result;
  }

  const targets = new Set();
  for (const value of Object.values(files || {})) {
    for (const fp of Array.isArray(value) ? value : [value]) {
      if (fp) targets.add(fp);
    }
  }
  // 适配包改的文件未必在内置补丁表里（包改名/挪位置），一并纳入备份范围
  try {
    const { packs } = loadPacks(dshHome, hostVersion);
    for (const pack of packs) {
      for (const edit of pack.edits) {
        if (edit?.file) targets.add(path.join(appDir, edit.file));
      }
    }
  } catch {
    /* 没有适配包就按内置表来 */
  }

  try {
    for (const fp of targets) {
      let current;
      try {
        current = fs.readFileSync(fp, "utf8");
      } catch {
        continue;
      }
      if (!current.includes(MARKER)) continue; // 没被改过，不需要备份

      const rel = path.relative(appDir, fp).split(path.sep).join("/");
      if (rel.startsWith("..")) {
        result.skipped += 1;
        continue;
      }

      let original;
      try {
        original = reader.readFile(rel);
      } catch (e) {
        result.errors.push(`${rel}: ${String(e && e.message ? e.message : e)}`);
        continue;
      }
      if (!original) {
        result.missingOriginal += 1;
        continue;
      }
      if (original.equals(Buffer.from(current, "utf8"))) {
        result.skipped += 1;
        continue;
      }

      const bak = existingBak(fp) || bakPath(fp);
      let same = false;
      if (fs.existsSync(bak)) {
        try {
          same = fs.readFileSync(bak).equals(original);
        } catch {
          same = false;
        }
      }
      if (same) {
        result.skipped += 1;
        continue;
      }

      try {
        if (!dryRun) fs.writeFileSync(bak, original);
        if (fs.existsSync(bak)) {
          result.rebuilt += 1;
          result.entries.push(`${rel}（bak 与官方原文不一致 → 已覆盖）`);
        } else {
          result.filled += 1;
          result.entries.push(rel);
        }
      } catch (e) {
        result.errors.push(`${rel}: ${String(e && e.message ? e.message : e)}`);
      }
    }
  } finally {
    reader.close();
  }
  return result;
}
