# 本地数据契约

每个输入对象代表一只股票，包含 `identityPacket`、`financialPacket`、`qualitativePacket`。三个字段既可为 JSON 对象，也可为序列化 JSON 字符串；生成 Market 请求时统一序列化为字符串。

## 身份与来源

`identityPacket` 至少包含：

```json
{
  "ticker": "AAPL",
  "companyName": "Apple Inc.",
  "industry": "Technology Hardware",
  "dataAsOf": "2026-07-29",
  "fiscalPeriod": "FY2025",
  "sources": ["https://www.sec.gov/..."]
}
```

- `ticker` 使用大写美股代码。
- `dataAsOf` 使用 ISO 日期，不得晚于检查日。
- `sources` 至少包含一个 HTTPS 链接。优先 SEC、公司 IR、交易所或其他一手来源。
- `fiscalPeriod` 明确当前主要财务口径；不同期间的数据不得伪装成同一期。

## 财务与估值

`financialPacket.marketSnapshot` 至少包含：

```json
{
  "price": 200.0,
  "currency": "USD",
  "asOf": "2026-07-29T20:00:00Z",
  "pe": 30.5
}
```

- `price` 必须为正数并绑定时间与币种。
- 市场快照超过 7 天视为硬失败。
- 亏损公司或指标无意义时，`pe` 可以为 `null`，但必须在 `financialPacket.unknowns` 解释。
- 不把盘中价格、收盘价和拆股前价格混为一谈。

`financialPacket.annualHistory` 至少提供三个有效财年：

```json
{
  "fiscalYearEnd": ["2023-09-30", "2024-09-28", "2025-09-27"],
  "revenue": [383285, 391035, 416161],
  "netIncome": [96995, 93736, 112010],
  "freeCashFlow": [99584, 108807, 98767]
}
```

- 所有历史数组长度与 `fiscalYearEnd` 一致。
- 单位放在字段旁或包级 `units`，不得省略。
- GAAP、non-GAAP 与本地派生指标分开。
- 派生值保留公式和输入键；云端只解释，不补算缺失事实。

建议同时提供 ROE/ROIC、经营现金流、资本开支、现金、总债务、租赁义务、稀释股数、回购、股权激励、自由现金流收益率和历史估值背景。

## 商业质量与风险

以下字段必须为数组：

```text
businessModel
moatEvidence
managementCulture
capitalAllocation
riskFactors
contraryEvidence
unknowns
```

前五类的每条事实使用：

```json
{
  "fact": "可核验的原子事实",
  "source": "https://...",
  "date": "2026-07-29",
  "sourceType": "SEC filing"
}
```

- 一个条目只表达一个事实。
- 来源和日期不能为空；超过 550 天的定性证据需更新或降级。
- 管理层宣传不能单独证明护城河、文化或竞争优势。
- 同时记录支持证据、反面证据和未知项。

## 时效和未知项

- 身份数据原则上不超过 45 天。
- 市场价格不超过 7 天。
- 未提供的事实必须留空或写入 `unknowns`，不得使用估计值伪装成事实。
- 缺少正常化 owner earnings、历史估值区间或明确机会成本时，不得判断“安全边际充足”。

