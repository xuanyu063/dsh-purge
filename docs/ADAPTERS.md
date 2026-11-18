# 适配补丁包（adapter packs）

> 解决的问题：内置补丁表按「某一版宿主的整段源码」写 needle。官方改一次函数形态、字段顺序、包名，就整片 `skipped`。补丁表不适合为每个版本各存一份，所以把「按新版源码重写过的 needle」抽成外部数据包，按宿主版本加载。

## 位置与加载

```
$DSH_HOME/dsh-purge/patches.d/
  ├── 0.2.2-rc.1.json
  ├── 0.2.3.json
  └── …
```

- 启动自愈、`--apply`、`--adapters` 都会读取该目录；
- 只加载 `hosts` 命中当前宿主版本的包，其余整包跳过（**绝不拿旧版本的 needle 去改新代码**）；
- 用户目录存放，宿主升级、插件重装都不会丢。

## 文件结构

```json
{
  "name": "0.2.2-rc.1 adapter pack",
  "hosts": ["0.2.2-rc.1"],
  "note": "内置补丁表按 0.2.0 的原文写 needle；这一版改了函数形态/包名/字段。",
  "edits": [
    {
      "id": 62,
      "file": "dsh/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js",
      "find": "\t\tif (approval === void 0) return {\n\t\t\tdecision: {\n\t\t\t\tkind: \"deny\" …",
      "replace": "\t\tif (approval === void 0) return {\n\t\t\tdecision: { kind: \"allow\" }, // [dsh-purge] …",
      "expect": 1,
      "marker": "no approval service → allow"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` / `hosts` / `note` | `hosts` 必填 | `hosts` 为空或缺省 = 所有版本；匹配规则是等值或以 `-` 前缀匹配 |
| `edits[].id` | ✅ | 对应内置补丁编号，用于登记 `adapted` 台账、面板显示 |
| `edits[].file` | ✅ | 相对 `resources/app`（桌面）或宿主根（web）的路径，用 `/` 分隔 |
| `edits[].find` | ✅ | 原文；`regex: true` 时按正则编译 |
| `edits[].replace` | ✅ | 替换文本；正则模式下支持 `$1` |
| `edits[].expect` | 否，默认 1 | **命中次数必须等于它才动手**，多一处少一处都不改 |
| `edits[].marker` | 建议 | 打完之后文件里应出现的标记；命中即视为「已完成」，可重复执行 |
| `edits[].tolerateMissing` | 否 | 删除型 edit 用：原文本来就不在 = 目标状态，算完成而不是失败 |

## 自己写一版（宿主机版本变了）

1. 先看差异有多大：

   ```sh
   dsh-purge --doctor                 # 版本对照 + skipped 数量
   dsh-purge --adapters --verify      # 现有包在这台机器上还命中几条
   ```

2. 对每条 `skipped`，找到它对应的内置补丁定义（`lib/core.js` 里的 `ALL_PATCHES`），把 `pattern` 当成目标行为，去当前宿主的真实源码里找等价片段：

   ```sh
   # 例：内置 needle 是「整段 approval.approver.request({...})」
   # 新版把它挪进 serviceAsk() 里，字段顺序也变了 → 按现场源码重写 find
   ```

3. 写成 `patches.d/<宿主版本>.json`，用 `--verify` 反复校验：**verify 是拿官方 asar 里的原文对的**，所以能确认你写的 needle 是针对「未打补丁的干净文件」，不是针对已经被改过的现状。

   ```sh
   dsh-purge --adapters --verify
   # 期望：N/N 可命中，1 个包生效于当前宿主
   ```

4. 应用并确认：

   ```sh
   dsh-purge --adapters          # 应用 + 自动登记 adapted 台账
   dsh-purge --doctor            # pending 应为 0
   ```

## 设计取舍

- **不用 AST**：宿主产物是打包压缩后的 ESM（单文件几万行、变量名被折叠），AST 能定位到函数但没有稳定的语义锚点；而「函数签名 + 内含字符串 + 命中次数」在实测里跨 minor 版本更稳，且失败时能明确报 `no_match` 而不是静默改错。
- **命中次数强校验**：`expect` 就是为了拒绝「模糊替换」——`find` 命中 2 处说明版本漂移，宁可跳过也不猜。
- **版本戳强制隔离**：包按宿主版本生效，升级后旧包自动失效。宁可少打，不可错打。
- **台账与包分离**：包说明「怎么改」，`$DSH_HOME/dsh-purge/adapted.json` 记录「本机改了哪些」，后者按宿主版本自动作废。
