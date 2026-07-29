#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const QUAL_GROUPS = ["businessModel", "moatEvidence", "managementCulture", "capitalAllocation", "riskFactors", "contraryEvidence", "unknowns"];
const FACT_GROUPS = QUAL_GROUPS.slice(0, 5);

function argsOf(argv) {
  const args = { asOf: new Date().toISOString().slice(0, 10), pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (["--input", "-i"].includes(value)) args.input = argv[++i];
    else if (["--output", "-o"].includes(value)) args.output = argv[++i];
    else if (value === "--as-of") args.asOf = argv[++i];
    else if (value === "--pretty") args.pretty = true;
    else if (["--help", "-h"].includes(value)) args.help = true;
    else throw new Error(`未知参数：${value}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.asOf) || Number.isNaN(Date.parse(`${args.asOf}T00:00:00Z`))) throw new Error("--as-of 必须为有效 YYYY-MM-DD 日期");
  return args;
}

function issue(code, message, severity = "error", path = "$") {
  return { code, severity, path, message };
}

function objectPacket(value, label, issues) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  issues.push(issue("PACKET_NOT_JSON_OBJECT", `${label} 必须是 JSON 对象`, "error", label));
  return {};
}

export function explicitCurrency(financial) {
  const match = String(financial?.units ?? "").trim().match(/^(USD|CNY|EUR|GBP|JPY|HKD)\b/);
  return match?.[1] ?? "";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value ?? "")) && !Number.isNaN(Date.parse(String(value)));
}

function ageDays(value, asOf) {
  return Math.floor((Date.parse(`${asOf}T23:59:59Z`) - Date.parse(String(value))) / 86400000);
}

function checkDate(value, path, maxDays, asOf, issues, severity = "error") {
  if (!validDate(value)) issues.push(issue("INVALID_DATE", `${path} 必须是有效日期`, "error", path));
  else if (ageDays(value, asOf) > maxDays) issues.push(issue("STALE_DATA", `${path} 距检查日超过 ${maxDays} 天`, severity, path));
  else if (ageDays(value, asOf) < -1) issues.push(issue("FUTURE_DATA", `${path} 晚于检查日`, "error", path));
}

function checkHistory(history, issues) {
  if (!history || typeof history !== "object" || Array.isArray(history)) {
    issues.push(issue("MISSING_ANNUAL_HISTORY", "financialPacket.annualHistory 必须是对象", "error", "financialPacket.annualHistory"));
    return;
  }
  const periods = history.fiscalYearEnd;
  if (!Array.isArray(periods) || periods.length < 3 || !periods.every(validDate)) {
    issues.push(issue("INVALID_FISCAL_PERIODS", "annualHistory.fiscalYearEnd 至少包含 3 个有效期间", "error", "financialPacket.annualHistory.fiscalYearEnd"));
    return;
  }
  for (const [key, values] of Object.entries(history)) {
    if (key !== "fiscalYearEnd" && Array.isArray(values) && values.length !== periods.length) {
      issues.push(issue("HISTORY_LENGTH_MISMATCH", `annualHistory.${key} 长度必须与 fiscalYearEnd 一致`, "error", `financialPacket.annualHistory.${key}`));
    }
  }
}

function checkQualitative(packet, asOf, issues) {
  for (const key of QUAL_GROUPS) {
    if (!Array.isArray(packet[key])) issues.push(issue("MISSING_QUALITATIVE_GROUP", `qualitativePacket.${key} 必须是数组`, "error", `qualitativePacket.${key}`));
  }
  for (const key of FACT_GROUPS) {
    for (const [index, item] of (packet[key] ?? []).entries()) {
      const path = `qualitativePacket.${key}[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        issues.push(issue("INVALID_QUALITATIVE_FACT", `${path} 必须是事实对象`, "error", path));
        continue;
      }
      if (!String(item.fact ?? "").trim()) issues.push(issue("FACT_MISSING", `${path}.fact 不能为空`, "error", `${path}.fact`));
      if (!String(item.source ?? "").trim()) issues.push(issue("FACT_SOURCE_MISSING", `${path}.source 不能为空`, "error", `${path}.source`));
      checkDate(item.date, `${path}.date`, 550, asOf, issues, "warning");
    }
  }
}

function checkRow(raw, rowIndex, asOf) {
  const issues = [];
  const identity = objectPacket(raw?.identityPacket, "identityPacket", issues);
  const financial = objectPacket(raw?.financialPacket, "financialPacket", issues);
  const qualitative = objectPacket(raw?.qualitativePacket, "qualitativePacket", issues);
  const ticker = String(raw?.ticker ?? identity.ticker ?? "").trim().toUpperCase();
  if (!TICKER.test(ticker)) issues.push(issue("INVALID_TICKER", "ticker 格式无效", "error", "ticker"));
  if (raw?.ticker && String(identity.ticker ?? "").trim().toUpperCase() !== ticker) issues.push(issue("TICKER_MISMATCH", "行 ticker 与 identityPacket.ticker 不一致", "error", "ticker"));
  if (!String(identity.companyName ?? "").trim()) issues.push(issue("COMPANY_NAME_MISSING", "identityPacket.companyName 不能为空", "error", "identityPacket.companyName"));
  if (!String(identity.fiscalPeriod ?? "").trim()) issues.push(issue("FISCAL_PERIOD_MISSING", "identityPacket.fiscalPeriod 不能为空", "error", "identityPacket.fiscalPeriod"));
  checkDate(identity.dataAsOf, "identityPacket.dataAsOf", 45, asOf, issues);
  if (!Array.isArray(identity.sources) || !identity.sources.some((source) => /^https:\/\//.test(String(source)))) {
    issues.push(issue("SOURCES_MISSING", "identityPacket.sources 至少包含一个 HTTPS 来源", "error", "identityPacket.sources"));
  }

  const snapshot = financial.marketSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    issues.push(issue("MISSING_MARKET_SNAPSHOT", "financialPacket.marketSnapshot 必须是对象", "error", "financialPacket.marketSnapshot"));
  } else {
    checkDate(snapshot.asOf, "financialPacket.marketSnapshot.asOf", 7, asOf, issues);
    if (!(Number(snapshot.price) > 0)) issues.push(issue("INVALID_PRICE", "marketSnapshot.price 必须为正数", "error", "financialPacket.marketSnapshot.price"));
    if (!String(snapshot.currency ?? "").trim()) {
      const currency = explicitCurrency(financial);
      if (currency) issues.push(issue("CURRENCY_NORMALIZED_FROM_UNITS", `价格币种可从 financialPacket.units 明确迁移为 ${currency}`, "warning", "financialPacket.marketSnapshot.currency"));
      else issues.push(issue("CURRENCY_MISSING", "marketSnapshot.currency 不能为空", "error", "financialPacket.marketSnapshot.currency"));
    }
    if (snapshot.pe !== null && snapshot.pe !== undefined && !Number.isFinite(Number(snapshot.pe))) issues.push(issue("INVALID_PE", "marketSnapshot.pe 必须是数字或 null", "error", "financialPacket.marketSnapshot.pe"));
    if ((snapshot.pe === null || snapshot.pe === undefined) && !(financial.unknowns ?? []).some((item) => /pe|市盈率|亏损/i.test(String(item)))) {
      issues.push(issue("PE_UNKNOWN_UNEXPLAINED", "PE 缺失时必须在 financialPacket.unknowns 说明", "warning", "financialPacket.unknowns"));
    }
  }
  checkHistory(financial.annualHistory, issues);
  checkQualitative(qualitative, asOf, issues);
  const errorCount = issues.filter(({ severity }) => severity === "error").length;
  return { rowIndex, ticker, valid: errorCount === 0, status: errorCount ? "blocked" : issues.length ? "degraded" : "ready", errorCount, warningCount: issues.length - errorCount, issues };
}

export function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.inputRows)) return payload.inputRows;
  return [payload];
}

export function preflight(payload, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = rowsOf(payload).map((row, index) => checkRow(row, index, asOf));
  const blockedRows = rows.filter(({ valid }) => !valid).length;
  const degradedRows = rows.filter(({ status }) => status === "degraded").length;
  return { schemaVersion: "loomloom-us-value-input-preflight/v1", asOf, valid: blockedRows === 0, summary: { totalRows: rows.length, readyRows: rows.length - blockedRows - degradedRows, degradedRows, blockedRows }, rows };
}

async function readText(path) {
  if (path !== "-") return readFile(path, "utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/preflight.mjs --input <packets.json|-> [--as-of YYYY-MM-DD] [--output report.json] [--pretty]\n");
  if (!args.input) throw new Error("必须提供 --input");
  const report = preflight(JSON.parse(await readText(args.input)), { asOf: args.asOf });
  const output = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.output) await writeFile(args.output, output, "utf8"); else process.stdout.write(output);
  process.exitCode = report.valid ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`输入预检错误：${error.message}\n`); process.exitCode = 2; });
