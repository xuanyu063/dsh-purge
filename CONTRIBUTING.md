# 参与贡献

## 最有价值的三种贡献

1. **适配包（adapter pack）** —— 宿主升级后内置补丁整片失配，最缺的就是「按新版本源码重写过 needle」的数据包。格式与流程见 [docs/ADAPTERS.md](docs/ADAPTERS.md)。提 PR 时请一并附上 `--adapters --verify` 的输出（应为全 `ok`）。
2. **体检项（doctor check）** —— 你遇到的「补丁打了但像没生效」的场景，如果能抽象成一条只读检查，就是体检表的新一行。
3. **补丁（patch）** —— 内置表里缺失的破甲点，或对既有补丁更稳的 needle（更短的锚点、更强的 marker）。

## 本地开发

```sh
git clone <this repo> dsh-purge
cd dsh-purge

# 语法检查（CI 同款）
for f in lib/index.js lib/core.js lib/reapply.js lib/update.js lib/uninstall.js lib/adapters.js lib/landing.js lib/doctor.js lib/bakfill.js lib/asar-read.js lib/adapted.js bin/dsh-purge.js client.js; do
  node --check "$f"
done

# 装到本机宿主（离线可用）
dsh plugin --profile desktop add .
```

改完补丁逻辑后务必跑：

```sh
dsh-purge --doctor
dsh-purge --adapters --verify
```

## 代码约定

- **只读优先**：体检、状态类功能不得修改宿主文件；写操作单独成命令并支持 `--dry-run`。
- **可回滚**：任何改宿主文件的地方，写前留 `.dshpurge.bak`，且备份必须等于官方原文（用 `--bakfill` 校验）。
- **失败要响**：命中次数不符、needle 不在，宁可跳过并报告，不做模糊替换。
- **no 魔法**：不引入运行时依赖；asar 解析、版本比对这类都手写，保持零依赖安装。

## 提交信息

```
<type>: <一句话>
```

`type` 取 `feat` / `fix` / `docs` / `chore` / `patch`（新增或调整补丁）。补丁类提交请在正文写明补丁编号与目标宿主版本。

## 审核标准

PR 会被问到的三件事：

1. 这个改动在**没打补丁的干净宿主**上验证过吗？（`--adapters --verify`）
2. 失败路径是什么？会不会静默改错？
3. 能不能回滚？（`.bak` + `--revert`）
