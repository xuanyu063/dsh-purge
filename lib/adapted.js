/**
 * 适配补丁台账（adapted patches ledger）。
 *
 * 背景：插件内置补丁表按某一版宿主的原文写 needle，官方一改代码就全部变成
 * skipped。有人在本地按新版源码重写 needle 并手工落盘时，文件其实已经改好，
 * 但 patchStatus 仍会报 skipped —— 面板与真实状态漂移。
 *
 * 这份台账用来显式声明「这些编号已在本地适配并落盘」，patchStatus 读到后
 * 把它们标成 adapted（与 applied 同义），面板与门禁都不再误报。
 *
 * 台账带宿主版本戳：宿主一升级，旧记录自动失效，避免拿上一版的「已改好」
 * 骗过新版本的自检。
 *
 * 存储：$DSH_HOME/dsh-purge/adapted.json
 *   { "entries": [ { id, name, host, at, files[], note } ] }
 */
import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "adapted.json";

export function adaptedPath(dshHome) {
  return path.join(dshHome || process.env.DSH_HOME || ".", "dsh-purge", FILE_NAME);
}

/** 宿主版本：resources/app/package.json 的 version（desktop）/ 包自身版本。 */
export function hostVersionAt(aiBase) {
  if (!aiBase) return "";
  // aiBase = <install>/resources/app/dsh/node_modules/@deepseek-ai
  // 桌面壳的 package.json 在 <install>/resources/app/package.json（上 3 层）。
  const guesses = [
    path.resolve(aiBase, "..", "..", "..", "package.json"),
    path.resolve(aiBase, "..", "..", "..", "..", "package.json"),
    path.resolve(aiBase, "..", "..", "package.json"),
  ];
  for (const fp of guesses) {
    try {
      const pkg = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (pkg && typeof pkg.version === "string") return pkg.version;
    } catch {
      /* 换下一个候选 */
    }
  }
  return "";
}

export function readAdapted(dshHome) {
  try {
    const raw = JSON.parse(fs.readFileSync(adaptedPath(dshHome), "utf8"));
    const entries = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
    return entries
      .map((e) => ({
        id: Number(e?.id),
        name: String(e?.name || ""),
        host: String(e?.host || ""),
        at: String(e?.at || ""),
        files: Array.isArray(e?.files) ? e.files.map(String) : [],
        note: String(e?.note || ""),
      }))
      .filter((e) => Number.isFinite(e.id) && e.id > 0);
  } catch {
    return [];
  }
}

/**
 * 有效适配编号。
 * hostVersion 为空时不做版本过滤（CLI 早期、纯前端场景）；拿到版本后只认
 * 同版本记录 —— 宿主升级后旧台账自动作废，需要重新适配。
 */
export function readAdaptedIds(dshHome, hostVersion = "") {
  const want = String(hostVersion || "").trim();
  const ids = new Set();
  for (const e of readAdapted(dshHome)) {
    if (want && e.host && e.host !== want) continue;
    ids.add(e.id);
  }
  return ids;
}

export function readAdaptedStale(dshHome, hostVersion = "") {
  const want = String(hostVersion || "").trim();
  if (!want) return [];
  return readAdapted(dshHome).filter((e) => e.host && e.host !== want);
}

/** 合并写入；同 id 覆盖，保留其他条目。 */
export function recordAdapted(dshHome, list, { host = "", note = "" } = {}) {
  const incoming = (Array.isArray(list) ? list : [list]).filter(Boolean);
  const byId = new Map(readAdapted(dshHome).map((e) => [e.id, e]));
  for (const item of incoming) {
    const id = Number(typeof item === "object" ? item.id : item);
    if (!Number.isFinite(id) || id <= 0) continue;
    const prev = byId.get(id);
    byId.set(id, {
      id,
      name: String((typeof item === "object" && item.name) || prev?.name || ""),
      host: host || prev?.host || "",
      at: new Date().toISOString(),
      files: (typeof item === "object" && Array.isArray(item.files) ? item.files : prev?.files || []).map(String),
      note: String((typeof item === "object" && item.note) || note || prev?.note || ""),
    });
  }
  const entries = [...byId.values()].sort((a, b) => a.id - b.id);
  const fp = adaptedPath(dshHome);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
  return entries;
}

export function clearAdapted(dshHome) {
  const fp = adaptedPath(dshHome);
  try {
    fs.rmSync(fp, { force: true });
    return true;
  } catch {
    return false;
  }
}
