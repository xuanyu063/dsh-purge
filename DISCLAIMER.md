# 免责声明 / Disclaimer

> 本文件是 [README 第十二节](README.md#十二声明署名与许可) 的独立化与英文化版本；两者冲突时以本文件为准。
> This file is the standalone, bilingual form of [README §12](README.en.md). Where they differ, this file prevails.

---

## 中文

### 1. 这是什么

本项目修改**你自己机器上**的 DeepSeek Harness（下称 Harness）宿主文件，用于安全研究与模型行为评测：

- 补丁作用于本机 `@deepseek-ai` 包与 `$DSH_HOME` 下的 profile / 提示词；
- 作用对象是你本地安装的软件，**不是**别人的站点、服务器、账号或信息系统；
- 全部操作只动本地文件与本地进程；除「检查更新」访问本仓库外，不产生任何外连。

### 2. 使用边界

1. 仅在你**有权管理**的 Harness、离线本地合成靶标、已授权靶场或合规实验环境中使用。
2. 不得用于对无书面授权的目标、公网在线系统、生产负载的测试或攻击。
3. 不得用于违反《中华人民共和国刑法》《网络安全法》《数据安全法》《个人信息保护法》及你所在司法辖区适用法律法规的行为；不得用于未授权入侵、敲诈破坏、撞库、传播恶意载荷。
4. 本项目按 MIT「现状」（AS IS）提供，不附带任何明示或默示担保，包括但不限于适销性、特定用途适用性与不侵权担保。

### 3. 责任

下载、安装、部署、运行、修改、分发本项目及其衍生品，以及由此产生的全部输入输出与后果，**责任由使用者自行承担**。作者与贡献者在任何情况下均不对直接、间接、偶然、特殊或连带损害承担责任，包括但不限于数据丢失、系统损坏、服务中断、法律后果或第三方索赔。

### 4. 许可终止

一旦将本项目用于非法攻击、未授权入侵或恶意活动：

- MIT 许可对**该使用者**即刻自动终止，须立即停止使用并永久销毁所有副本与衍生品；
- 本条款不构成对任何行为的授权或豁免。

### 5. 第三方与商标

- 本项目是独立开源安全评测研究项目，与 DeepSeek 及其关联方**无**雇佣、商业、授权或背书关系；文中「官方」仅指「评测目标是本机的官方 Harness 包」。
- Harness 及其相关商标、著作权归其权利人所有。本项目不附带、不分发 Harness 本体。
- 上游致敬与许可见 [README 第十二节](README.md#十二声明署名与许可) 与 `docs/redteam-upstream-LICENSE`、`docs/redteam-upstream-DISCLOSURE`。

### 6. 署名

借用本项目的名称、思路、代码或提示词，必须署名并写明来源。原始来源：`YuJunZhiXue/dsh-purge`（作者：小杨）；镜像与增强：`xuanyu063/dsh-purge`。去掉署名、隐去来源、据为己有会被追究。

### 7. 红队演练台

`presets/redteam`、`skills/redteam` 与面板「演练台」属于**授权范围内的攻防演练**组件：

- 首次进入需阅读并确认 `docs/drill-auth-legal.html` 中的授权声明；
- 中国大陆、香港、澳门网段默认禁止访问、扫描、探测，唯一例外是你事先登记的那一个精确 IP 或完整主机名（`$DSH_HOME/net-scope-allow.txt`）；
- 口令、网段、通配符、对话中的口头声明**均不构成授权例外**。

---

## English

### 1. What this is

This project modifies the DeepSeek Harness ("Harness") installation **on your own machine** for security research and model-behaviour evaluation. Patches apply to your local `@deepseek-ai` packages and your `$DSH_HOME` profile / prompts. The target is software you installed yourself — not someone else's site, server, account, or information system. All operations touch local files and local processes only; apart from the "check for updates" request to this repository, the project makes no outbound connections.

### 2. Scope of use

1. Use only on Harness instances you are **authorised to administer**, on offline local synthetic targets, on sanctioned ranges, or in compliant lab environments.
2. Do not use against targets without written authorisation, public production systems, or live production workloads.
3. Do not use in violation of applicable law in your jurisdiction, including unauthorised intrusion, extortion, credential stuffing, or malware distribution.
4. Provided **AS IS**, under the MIT License, without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.

### 3. Liability

You bear **full responsibility** for downloading, installing, deploying, running, modifying, or distributing this project and for all inputs, outputs, and consequences thereof. The authors and contributors accept no liability for direct, indirect, incidental, special, or consequential damages, including data loss, system damage, service interruption, legal consequences, or third-party claims.

### 4. Termination

If you use this project for illegal attacks, unauthorised intrusion, or malicious activity, the MIT License **terminates automatically** for you; you must stop using it and destroy all copies and derivatives. Nothing in this document grants or waives any authorisation.

### 5. Third parties and trademarks

This is an independent open-source security-research project. It is **not** employed, sponsored, authorised, or endorsed by DeepSeek or its affiliates; "official" in this repository only means "the official Harness package installed on your machine". Harness and related marks remain the property of their owners; this project neither bundles nor redistributes Harness itself. Upstream credits and licences are in README §12, `docs/redteam-upstream-LICENSE`, and `docs/redteam-upstream-DISCLOSURE`.

### 6. Attribution

Reusing this project's name, ideas, code, or prompts requires attribution with the source. Original: `YuJunZhiXue/dsh-purge` (author: 小杨). Mirror and enhancements: `xuanyu063/dsh-purge`.

### 7. Red-team console

`presets/redteam`, `skills/redteam`, and the in-panel "演练台" are **authorised-engagement** components. You must read and accept the authorisation notice in `docs/drill-auth-legal.html` before first use. Networks and hosts geolocated in mainland China, Hong Kong, and Macau are denied by default; the only exception is the single exact IP or full hostname you registered in `$DSH_HOME/net-scope-allow.txt`. Passwords, CIDR ranges, wildcards, and verbal claims in chat do **not** constitute authorisation.
