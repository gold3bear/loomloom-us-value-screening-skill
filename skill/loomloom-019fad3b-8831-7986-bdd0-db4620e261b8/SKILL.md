---
name: "loomloom-019fad3b-8831-7986-bdd0-db4620e261b8"
description: "批量研究美股长期价值，使用本地 Agent 采集和校验股票身份、财务估值、商业质量与风险证据，再调用 LoomLoom 公开 SkillBot 做云端并行审查，最后在本地执行证据审计、硬性否决、确定性排序和 Markdown 报告。用于用户提供美股代码、股票清单、CSV/Excel 财务表，或要求价值投资初筛、批量比较、更新价格后复跑时。"
---

# 美股长期价值批量初筛

把用户的股票代码或表格转成可审计的数据包，经 LoomLoom 云端并行研究后，在本地验证、合并并生成研究报告。仅用于研究辅助，不构成投资建议，不输出目标价、仓位或买卖指令。

## 固定边界

- 公开 Listing：`019fad3b-8831-7986-bdd0-db4620e261b8`。
- 始终在执行前读取当前 Listing 和公开输入结构，只通过 Market 路径运行。
- 不展示、推断或打包云端私有提示词、步骤 ID、模型设置、模板定义或内部映射。
- 不把 Token 写入 Skill、数据文件、日志或报告。
- 本地准备、校验、报价和报告生成不等于授权付费执行。
- 每次真实运行都先取得服务端报价，向用户展示任务数、币种与费用，再获得当次明确确认。
- 用户确认后如股票、数据、文件、Listing 或报价变化，重新校验、报价和确认。

## 用户入口

接受以下任一形式：

- 股票代码，例如“分析 AAPL、COST、UAL”。
- CSV、Excel 或 JSON 股票清单。
- 用户已有的标准财务指标表。
- 已准备好的三个 JSON 数据包。

不要要求普通用户手工编写 `identityPacket`、`financialPacket` 或 `qualitativePacket`。缺少材料时一次只询问一个会阻断进度的问题；在用户允许本地检索且来源可获得时，由本地 Agent 补齐。

## 安装 LoomLoom CLI

本技能的云端步骤（就绪检查、读取公开契约、报价、运行）依赖 `loomloom` CLI。如果本地未安装，按以下方式安装：

### 一键安装

将以下指令粘贴给 AI 助手（Claude Code / Codex / OpenClaw / WorkBuddy 等），或手动执行：

> 请你在这个项目里安装 LoomLoom：安装地址是 https://github.com/Cogfoundry-ai/loomloom 或 https://gitee.com/cogfoundry/loomloom，服务地址：https://loomloom.shengsuanyun.com/loom/v1，Token 是【替换成你自己的胜算云密钥】。安装好之后帮我运行一次 doctor 检查是否正常。

### 手动安装步骤

1. **申请密钥**：前往 https://console.shengsuanyun.com/user/keys 申请胜算云 API 密钥。
2. **克隆仓库**：
   ```bash
   git clone https://gitee.com/cogfoundry/loomloom.git
   # 或 GitHub（如可访问）：
   # git clone https://github.com/Cogfoundry-ai/loomloom.git
   ```
3. **运行安装脚本**：进入克隆的目录，按照仓库 README 中的说明完成安装。
4. **配置环境变量**（写入 `~/.zshrc` 或 `~/.bashrc`）：
   ```bash
   export LOOMLOOM_SERVER='https://loomloom.shengsuanyun.com/loom/v1'
   export LOOMLOOM_TOKEN='你的胜算云密钥'
   ```
5. **验证安装**：
   ```bash
   source ~/.zshrc  # 或重新打开终端
   loomloom doctor
   ```
   `doctor` 通过后即可使用本技能的云端步骤。

## 端到端工作流

### 1. 就绪检查

首次使用或遇到鉴权、服务、网络异常时，运行 `loomloom doctor` 检查 CLI、HTTPS Server 和登录状态。如果 `loomloom` 命令不存在，按上方[安装 LoomLoom CLI](#安装-loomloom-cli) 章节的步骤安装。正常业务输入错误不要自动运行 doctor。

### 2. 读取当前公开契约

运行：

```bash
loomloom market show 019fad3b-8831-7986-bdd0-db4620e261b8 --output json
```

仅从当前公开输入结构收集字段。Listing 不可用、权限失败或版本不能执行时停止，不替换模板或绕过 Market。

### 3. 本地构建数据包

每行一只股票，构建：

- `identityPacket`：ticker、companyName、行业、数据截止日、财报期间、HTTPS 来源。
- `financialPacket`：当前价格与时间、历史财务、现金流、资本回报、资产负债、股本和估值事实。
- `qualitativePacket`：商业模式、护城河、管理层、资本配置、风险、反面证据和未知项。

优先使用 SEC 文件、公司投资者关系材料和可核验的一手来源。管理层自述必须标识来源；无法独立确认时写入 `unknowns`。GAAP 与调整后口径分开。读取 [数据契约](references/data-contract.md) 获取完整约束。

### 4. 本地预检与请求生成

先执行：

```bash
node scripts/preflight.mjs --input <packets.json> --output <preflight.json> --pretty
```

退出码 `1` 表示存在硬失败，不得报价或运行。修正后再生成 Market 请求：

```bash
node scripts/prepare-market-input.mjs --input <packets.json> --output <market-request.json> --pretty
```

向用户摘要显示每只股票的数据截止日、价格时点、来源覆盖、未知项和降级项，不展示大段内部 JSON。

### 5. 报价与确认

程序化输入已由本地脚本生成，因此使用 JSON Market 流程：

```bash
loomloom market quote 019fad3b-8831-7986-bdd0-db4620e261b8 --input-file <market-request.json> --output json
```

使用服务端返回值展示：任务数、每任务创作者服务费、预计预授权总额、币种、余额状态，以及模型/API 费用是否单独返回。缺失字段不猜测，不自行换算币种。

等待用户在当前对话明确确认。确认后为本次请求创建新的 `client-request-id`：

```bash
loomloom market run 019fad3b-8831-7986-bdd0-db4620e261b8 \
  --input-file <market-request.json> --confirm --client-request-id <id> --output json
```

### 6. 等待与取回

返回并保存 `runTransactionId` 和 `runId`。使用 `loomloom run watch <run-id>` 等待；完成后获取完整结果：

```bash
loomloom run result-rows <run-id> --output json > <result-rows.json>
```

若部分失败，保留成功结果。任何失败项的重新付费运行都必须重新报价并确认。

### 7. 本地审计、合并与报告

本地合并器依据输出 JSON 的公开字段形状识别四个研究维度，不依赖或泄露私有步骤 ID：

```bash
node scripts/merge-public-results.mjs \
  --input <result-rows.json> --output <local-audit.json> --pretty

node scripts/render-report.mjs \
  --input <local-audit.json> --output <report.md>
```

只有证据路径能解析到该行输入、`source_value` 与原子事实完全一致、价格和财报期间有效、且未触发硬性否决的股票才能进入排名。被拒绝证据不得进入结论。读取 [决策与审计规则](references/decision-policy.md) 获取详细规则。

### 8. 交付

交付报告、审计 JSON、运行 ID、订单 ID、数据与价格截止时间以及实际费用（若服务返回）。报告分层使用：

- `deep_research`：值得进入人工深度研究。
- `watchlist`：观察，等待数据或价格条件改善。
- `pass`：暂不进入下一轮。
- `rejected`：本地结构或证据校验失败，不参与排名。

允许用户追加股票、更新财报或价格后复跑；任何输入变化都重新预检和报价。

## 资源路由

- 准备或核查输入时读取 [references/data-contract.md](references/data-contract.md)。
- 合并、解释排名或处理校验失败时读取 [references/decision-policy.md](references/decision-policy.md)。
- 运行本地测试：`node --test scripts/*.test.mjs`。
- 修改 Skill 后使用 skill-creator 的 `quick_validate.py` 校验目录。

