# LoomLoom 美股价值初筛 Skill

面向本地 Agent 的美股长期价值批量初筛 Skill。它先在本地准备与校验数据，再通过 LoomLoom 公开 SkillBot 并行研究，最后在本地进行证据审计、否决与排序。

> 仅用于研究辅助，不构成投资建议；不输出目标价、仓位或买卖指令。

## 先安装：给 Agent 的指令

将下面整段文字交给你的 Agent 即可：

> 请打开 https://github.com/gold3bear/loomloom-us-value-screening-skill ，从 Releases 下载最新的 `loomloom-us-value-screening-skill-v2.zip`。解压后，将目录 `loomloom-019fad3b-8831-7986-bdd0-db4620e261b8` 安装到本地 Agent 的 Skills 目录，保留其所有文件和目录结构。安装仅是本地文件操作，不要创建 LoomLoom 云端任务。随后阅读其中 `SKILL.md`，检查 LoomLoom CLI 是否可用，并运行 `loomloom doctor`；若尚未配置，则提示我提供自己的胜算云密钥。不要把密钥写入 Skill、仓库、日志或报告。

## 下载 Skill

请只从 [GitHub Releases](https://github.com/gold3bear/loomloom-us-value-screening-skill/releases/latest) 下载 `loomloom-us-value-screening-skill-v2.zip`。ZIP 不随 Git 源码提交，避免把发布制品与可审查源码混在一起。

## Codex 手动安装

在需要使用 Skill 的项目根目录执行：

```bash
curl -L \
  https://github.com/gold3bear/loomloom-us-value-screening-skill/releases/latest/download/loomloom-us-value-screening-skill-v2.zip \
  -o /tmp/loomloom-us-value-screening-skill-v2.zip

mkdir -p .codex/skills
unzip -q /tmp/loomloom-us-value-screening-skill-v2.zip -d .codex/skills
```

安装完成后，应存在：

```text
.codex/skills/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/SKILL.md
```

全局安装时，将 `.codex/skills` 替换为 `~/.codex/skills`。其他 Agent 使用各自的本地 Skills 目录，但解压出的 Skill 目录名必须保持不变。

## 配置 LoomLoom CLI

本 Skill 的云端研究步骤依赖 LoomLoom CLI。CLI 未安装时，克隆官方仓库并按其 README 安装：

```bash
git clone https://github.com/Cogfoundry-ai/loomloom.git
# 国内网络可替换为：https://gitee.com/cogfoundry/loomloom.git
```

配置你自己的胜算云凭据（不要提交到 Git）：

```bash
export LOOMLOOM_SERVER='https://loomloom.shengsuanyun.com/loom/v1'
export LOOMLOOM_TOKEN='替换为你自己的胜算云密钥'
loomloom doctor
```

`doctor` 通过后，阅读已安装 Skill 中的 `SKILL.md`，再输入股票代码或标准化财务指标表开始研究。

## 运行原则

1. 先在本地执行预检与数据包构建。
2. 每次云端运行前必须取得服务端报价，并由用户当次明确确认。
3. 云端结果必须经本地证据审计、否决项与复跑条件检查后才进入排序。
4. 输入、价格、数据期间或报价变动后，必须重新预检、报价和确认。

## 仓库结构

```text
index.html                         静态介绍页
loomloom-us-value-screening-poster-v1.png  页面海报
skill/                             v2 Skill 可审查源码
docs/brand-spec.md                 页面视觉与素材说明
```

## 本地验证

```bash
node --test skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/scripts/*.test.mjs
```

## 许可

本仓库采用 [MIT License](LICENSE)。使用时仍应遵守 LoomLoom 服务条款与相关数据来源的使用限制。
