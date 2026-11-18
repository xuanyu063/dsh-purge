/**
 * 只读 asar 读取器（用于从官方封包里取回"原文"）。
 *
 * 场景：补丁改过的文件旁边没有 `.dshpurge.bak` 时，「还原」就拿不到原文，
 * 只能整包重新解压。而官方 asar（或改名后的 app.asar.sealed-*）本身就是
 * 那份原文，直接按路径读出来写 bak 即可。
 *
 * asar 布局（实测 0.2.2-rc.1）：
 *   [4B 常量][4B pickleSize][4B ?][4B jsonLen][json...][文件数据...]
 *   json 起始偏移 = 第一个 '{' 的位置（通常 16）
 *   数据基址 base = json 起始 + jsonLen，条目里的 offset 相对 base
 */
import fs from "node:fs";

const HEADER_PROBE = 64 * 1024;

export function openAsar(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(HEADER_PROBE);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    const view = head.subarray(0, n);
    const start = view.indexOf(0x7b); // '{'
    if (start < 4) throw new Error("asar 头部里找不到 JSON 起始");
    const jsonLen = view.readUInt32LE(start - 4);
    if (!jsonLen || jsonLen > 64 * 1024 * 1024) throw new Error(`asar JSON 长度异常: ${jsonLen}`);
    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, start);
    const header = JSON.parse(jsonBuf.toString("utf8"));
    const base = start + jsonLen;
    return {
      filePath,
      header,
      /** rel 用 / 分隔、相对 asar 根 */
      readFile(rel) {
        // 目录节点形如 { files: {…} }，文件节点形如 { size, offset }，
        // 所以每一级都要先下到 .files 再取名字。
        let node = { files: header.files };
        for (const seg of String(rel).split("/")) {
          if (!node || !node.files) return null;
          node = node.files[seg];
        }
        if (!node || node.files || node.size === undefined || node.offset === undefined) return null;
        const size = Number(node.size);
        if (!Number.isFinite(size) || size < 0) return null;
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, base + Number(node.offset));
        return buf;
      },
      close() {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      },
    };
  } catch (e) {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** 在 resources 目录里找官方包：优先 app.asar，其次最新的 app.asar.sealed-*。 */
export function findOriginalArchive(resourcesDir) {
  const direct = `${resourcesDir}${process.platform === "win32" ? "\\" : "/"}app.asar`;
  if (fs.existsSync(direct)) return direct;
  let best = "";
  let bestTime = 0;
  let names = [];
  try {
    names = fs.readdirSync(resourcesDir);
  } catch {
    return "";
  }
  for (const name of names) {
    if (!/^app\.asar\.sealed-/.test(name)) continue;
    const fp = `${resourcesDir}${process.platform === "win32" ? "\\" : "/"}${name}`;
    try {
      const t = fs.statSync(fp).mtimeMs;
      if (t > bestTime) {
        bestTime = t;
        best = fp;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}
