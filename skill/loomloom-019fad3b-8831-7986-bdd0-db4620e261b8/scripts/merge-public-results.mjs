#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const DIMENSIONS = ["business", "moat", "financial", "valuation"];
const WEIGHTS = { understandability: 0.10, business_model: 0.20, moat: 0.20, management_capital_allocation: 0.15, financial_quality: 0.20, valuation_opportunity_cost: 0.15 };
const CONFIDENCE = { high: 3, medium: 2, low: 1 };

function argsOf(argv) {
  const args = { pretty: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (["--input", "-i"].includes(argv[i])) args.input = argv[++i];
    else if (["--output", "-o"].includes(argv[i])) args.output = argv[++i];
    else if (argv[i] === "--pretty") args.pretty = true;
    else if (["--help", "-h"].includes(argv[i])) args.help = true;
    else throw new Error(`未知参数：${argv[i]}`);
  }
  return args;
}

function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function parseJson(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null, normalized: false, error: `${label} 为空` };
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
  try { return { value: JSON.parse(fenced ? fenced[1] : raw), normalized: Boolean(fenced), error: null }; }
  catch { return { value: null, normalized: Boolean(fenced), error: `${label} 不是有效 JSON` }; }
}

const PACKET_LABELS = { IDENTITY: "identityPacket", FINANCIAL: "financialPacket", QUALITATIVE: "qualitativePacket" };

function extractPacketFromPrompt(prompt, label) {
  const idx = prompt.indexOf(label + ":");
  if (idx === -1) return null;
  const afterLabel = prompt.slice(idx + label.length + 1);
  let endIdx = afterLabel.length;
  for (const otherLabel of Object.keys(PACKET_LABELS)) {
    const otherIdx = afterLabel.indexOf("\n" + otherLabel + ":");
    if (otherIdx > 0 && otherIdx < endIdx) endIdx = otherIdx;
  }
  const jsonStr = afterLabel.slice(0, endIdx).trim();
  try { return JSON.parse(jsonStr); } catch { return null; }
}

function stepsToInput(outer) {
  const steps = outer.steps;
  if (!isObject(steps)) return null;
  const result = {};
  for (const step of Object.values(steps)) {
    if (!isObject(step) || typeof step.prompt !== "string") continue;
    for (const [label, key] of Object.entries(PACKET_LABELS)) {
      if (result[key]) continue;
      const packet = extractPacketFromPrompt(step.prompt, label);
      if (packet) result[key] = packet;
    }
    if (result.identityPacket && result.financialPacket && result.qualitativePacket) break;
  }
  return Object.keys(result).length >= 3 ? result : null;
}

function parseInput(row) {
  const outer = typeof row.inputJson === "string" ? JSON.parse(row.inputJson) : row.inputJson ?? row.input ?? {};
  const stepsResult = stepsToInput(outer);
  if (stepsResult) return stepsResult;
  const input = {};
  for (const [key, value] of Object.entries(outer)) {
    if (typeof value !== "string") input[key] = value;
    else {
      try { input[key] = JSON.parse(value); }
      catch { input[key] = value; }
    }
  }
  return input;
}

function classify(value) {
  if (!isObject(value)) return null;
  if ("business_model_score" in value && "understandability_score" in value) return "business";
  if ("moat_score" in value && "capital_allocation_score" in value) return "moat";
  if ("financial_quality_score" in value && "balance_sheet_score" in value) return "financial";
  if ("valuation_score" in value && "margin_of_safety_score" in value) return "valuation";
  return null;
}

function artifactText(item) {
  if (typeof item?.inlineText === "string") return item.inlineText;
  if (typeof item?.text === "string") return item.text;
  if (typeof item?.content === "string") return item.content;
  return "";
}

function reviewsOf(row, errors) {
  const reviews = {};
  let normalized = false;
  for (const [index, item] of (row.artifacts ?? []).entries()) {
    const parsed = parseJson(artifactText(item), `第 ${index + 1} 个云端输出`);
    normalized ||= parsed.normalized;
    if (parsed.error) continue;
    const dimension = classify(parsed.value);
    if (!dimension) continue;
    if (reviews[dimension]) errors.push(`检测到重复的 ${dimension} 维度输出`);
    else reviews[dimension] = parsed.value;
  }
  for (const dimension of DIMENSIONS) if (!reviews[dimension]) errors.push(`缺少可识别的 ${dimension} 维度输出`);
  return { reviews, normalized };
}

function pathParts(path) { return String(path).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean); }

function getPath(root, path) {
  let value = root;
  for (const part of pathParts(path)) {
    if (value === null || value === undefined || !(part in Object(value))) return undefined;
    value = value[part];
  }
  return value;
}

function sourceRef(value) {
  return /^(identityPacket|financialPacket|qualitativePacket)(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])+$/.test(String(value ?? ""));
}

function atomic(value) { return value === null || ["string", "number", "boolean"].includes(typeof value); }
function same(left, right) {
  if (JSON.stringify(left) === JSON.stringify(right)) return true;
  const leftStr = String(left ?? "");
  const rightStr = String(right ?? "");
  if (!leftStr || !rightStr) return false;
  if (typeof left === "string" && typeof right === "string") {
    if (rightStr.includes(leftStr)) return true;
    const resultMatch = leftStr.match(/=\s*([^=]+?)\s*$/);
    if (resultMatch) {
      const result = resultMatch[1].trim();
      if (result && (rightStr.trim() === result || rightStr.includes(result))) return true;
    }
    return false;
  }
  if (typeof left === "number" && typeof right === "string") {
    const escaped = leftStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(rightStr);
  }
  if (typeof right === "number" && typeof left === "string") {
    const escaped = rightStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(leftStr);
  }
  return false;
}
function text(value) { return String(value ?? "").trim(); }

function score(value, label, errors) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    errors.push(`${label} 必须是 0-100 整数`);
    return 0;
  }
  return value;
}

function requireArray(review, keys, dimension, errors) {
  for (const key of keys) if (!Array.isArray(review[key])) errors.push(`${dimension}.${key} 必须是数组`);
  if (!text(review.summary)) errors.push(`${dimension}.summary 不能为空`);
}

function shape(reviews, errors) {
  requireArray(reviews.business, ["evidence_records", "positive_points", "contrary_points", "unknowns"], "business", errors);
  requireArray(reviews.moat, ["evidence_records", "positive_points", "contrary_points", "governance_red_flags", "unknowns"], "moat", errors);
  requireArray(reviews.financial, ["evidence_records", "positive_points", "contrary_points", "accounting_red_flags", "survival_risks", "unknowns"], "financial", errors);
  requireArray(reviews.valuation, ["evidence_records", "validity_basis", "falsification_conditions", "positive_points", "contrary_points", "valuation_red_flags", "forbidden_numeric_claims", "unknowns"], "valuation", errors);
}

function auditEvidence(reviews, input) {
  const verified = [];
  const rejected = [];
  const byDimension = Object.fromEntries(DIMENSIONS.map((key) => [key, 0]));
  const seen = new Set();
  for (const [dimension, review] of Object.entries(reviews)) {
    for (const item of review.evidence_records ?? []) {
      const ref = text(item?.source_ref);
      let reason = "";
      if (!text(item?.claim) || !ref || item?.source_value === undefined || !text(item?.period) || !text(item?.unit)) reason = "证据字段不完整";
      else if (!sourceRef(ref)) reason = "source_ref 必须使用完整公开输入路径";
      else if (!atomic(item.source_value)) reason = "source_value 必须是原子值";
      else if (getPath(input, ref) === undefined) reason = "source_ref 无法解析到输入";
      else if (!same(getPath(input, ref), item.source_value)) reason = "source_value 与输入原值不一致";
      if (reason) rejected.push({ dimension, claim: item?.claim ?? "", source_ref: ref, reason });
      else {
        const id = `${dimension}:${ref}:${JSON.stringify(item.source_value)}`;
        if (!seen.has(id)) {
          seen.add(id);
          verified.push({ evidence_id: `E${String(verified.length + 1).padStart(2, "0")}`, dimension, claim: item.claim, source_ref: ref, source_value: item.source_value, period: item.period, unit: item.unit });
          byDimension[dimension] += 1;
        }
      }
    }
  }
  return { verified, rejected, byDimension };
}

function traceRecords(records, label, input, errors, { min, max, condition = false } = {}) {
  if (!Array.isArray(records)) return errors.push(`${label} 必须是数组`);
  if (records.length < min || records.length > max) errors.push(`${label} 必须包含 ${min}-${max} 项`);
  for (const item of records) {
    if (!text(item?.[condition ? "condition" : "claim"])) errors.push(`${label} 条目缺少 ${condition ? "condition" : "claim"}`);
    if (!sourceRef(item?.source_ref)) errors.push(`${label}.source_ref 必须使用完整输入路径`);
    else if (getPath(input, item.source_ref) === undefined) errors.push(`${label}.source_ref 无法解析到输入`);
    else if (!atomic(item.source_value) || !same(getPath(input, item.source_ref), item.source_value)) errors.push(`${label}.source_value 未原样复制输入原子值`);
    if (!text(item?.period) || !text(item?.unit)) errors.push(`${label} 条目缺少 period 或 unit`);
    if (condition && !["rerun_required", "conclusion_invalidated"].includes(item?.action)) errors.push(`${label}.action 无效`);
  }
}

function numericTokens(value) { return String(value ?? "").match(/(?<![A-Za-z])[-+]?\d+(?:\.\d+)?%?/g) ?? []; }

function forbiddenForecast(value) {
  const body = String(value ?? "");
  return /(目标价|未来股价|预测增长率|预测利润率|贴现率|终值倍数|概率|target price|future share price|forecast growth|forecast margin|discount rate|terminal multiple)/i.test(body) && numericTokens(body).length > 0;
}

function unknownKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function mergeRow(row, index) {
  const errors = [];
  let input = {};
  try { input = parseInput(row); } catch { errors.push("inputJson 无法解析"); }
  if (row.status && row.status !== "completed") errors.push(`云端行状态为 ${row.status}`);
  const { reviews, normalized } = reviewsOf(row, errors);
  const ticker = text(input.identityPacket?.ticker).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) errors.push("输入 ticker 无效");
  if (errors.length) return rejected(row, index, ticker, errors, normalized);

  shape(reviews, errors);
  const biz = reviews.business;
  const moat = reviews.moat;
  const fin = reviews.financial;
  const val = reviews.valuation;
  if (!new Set(["pass", "uncertain", "fail"]).has(biz.circle_of_competence)) errors.push("circle_of_competence 无效");
  if (!new Set(["insufficient_margin_of_safety", "evidence_insufficient", "eligible_for_manual_deep_research"]).has(val.judgment_state)) errors.push("judgment_state 无效");
  traceRecords(val.validity_basis, "validity_basis", input, errors, { min: 2, max: 3 });
  traceRecords(val.falsification_conditions, "falsification_conditions", input, errors, { min: 2, max: 4, condition: true });
  const basisRefs = new Set((val.validity_basis ?? []).map((item) => item?.source_ref));
  if (![...basisRefs].some((ref) => /^financialPacket\.marketSnapshot\.(price|asOf)$/.test(ref))) errors.push("validity_basis 必须引用价格或价格时间");
  if (![...basisRefs].some((ref) => /^(identityPacket\.(fiscalPeriod|dataAsOf)|financialPacket\.latestOperatingUpdate\.periodEnd|financialPacket\.annualHistory\.fiscalYearEnd\[\d+\])$/.test(ref))) errors.push("validity_basis 必须引用财报期间或数据截止日");

  const components = {
    understandability: score(biz.understandability_score, "understandability_score", errors),
    business_model: score(biz.business_model_score, "business_model_score", errors),
    moat: score(moat.moat_score, "moat_score", errors),
    management_capital_allocation: Math.round((score(moat.management_culture_score, "management_culture_score", errors) + score(moat.capital_allocation_score, "capital_allocation_score", errors)) / 2),
    financial_quality: score(fin.financial_quality_score, "financial_quality_score", errors),
    valuation_opportunity_cost: Math.round((score(val.valuation_score, "valuation_score", errors) + score(val.margin_of_safety_score, "margin_of_safety_score", errors)) / 2),
  };
  if (errors.length) return rejected(row, index, ticker, errors, normalized);

  const evidence = auditEvidence(reviews, input);
  const veto = [];
  if (biz.circle_of_competence === "fail") veto.push("circle_of_competence_fail");
  for (const dimension of DIMENSIONS) if (evidence.byDimension[dimension] === 0) veto.push(`missing_verified_evidence_${dimension}`);
  if ((fin.survival_risks?.length ?? 0) && fin.balance_sheet_score < 30) veto.push("survival_risk_with_weak_balance_sheet");
  if ((moat.governance_red_flags?.length ?? 0) && components.management_capital_allocation < 30) veto.push("governance_red_flags_with_weak_management_score");
  if ((fin.accounting_red_flags?.length ?? 0) && fin.financial_quality_score < 30) veto.push("accounting_red_flags_with_weak_financial_score");
  if (val.margin_of_safety_score < 30) veto.push("insufficient_margin_of_safety");
  if (val.judgment_state !== "eligible_for_manual_deep_research") veto.push("valuation_not_eligible_for_manual_deep_research");
  const valuationText = [val.summary, ...(val.positive_points ?? []), ...(val.contrary_points ?? []), ...(val.valuation_red_flags ?? [])].join("\n");
  if (forbiddenForecast(valuationText)) veto.push("forbidden_numeric_claims");
  if (evidence.rejected.length > evidence.verified.length || evidence.rejected.length >= 6) veto.push("excessive_rejected_evidence");

  const overall = Math.round(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0));
  const unknowns = [...new Set(DIMENSIONS.flatMap((dimension) => (reviews[dimension].unknowns ?? []).map(unknownKey).filter(Boolean)))];
  const uniqueVeto = [...new Set(veto)];
  const auditStatus = uniqueVeto.includes("excessive_rejected_evidence") ? "fail" : evidence.rejected.length || unknowns.length > 3 ? "warn" : "pass";
  const confidence = uniqueVeto.length ? "low" : evidence.verified.length >= 8 && unknowns.length <= 3 ? "high" : "medium";
  const decision = uniqueVeto.length ? "pass" : biz.circle_of_competence === "uncertain" ? "watchlist" : overall >= 75 ? "deep_research" : overall >= 60 ? "watchlist" : "pass";
  const eligible = decision === "deep_research" && auditStatus === "pass" && confidence !== "low" && !uniqueVeto.length;
  const market = input.financialPacket?.marketSnapshot ?? {};
  return {
    rowIndex: row.rowIndex ?? index, ticker, company_name: input.identityPacket?.companyName ?? "", valid: true,
    validationStatus: normalized ? "normalized" : "valid", normalized, decision, decision_eligible: eligible,
    overall_score: overall, component_scores: components, confidence, audit_status: auditStatus,
    hallucination_risk: auditStatus === "fail" ? "high" : auditStatus === "warn" ? "medium" : "low",
    price: market.price ?? null, price_currency: market.currency ?? "", price_as_of: market.asOf ?? "",
    fiscal_period: input.identityPacket?.fiscalPeriod ?? "", data_as_of: input.identityPacket?.dataAsOf ?? "",
    valuation_judgment_state: val.judgment_state, validity_basis: val.validity_basis,
    falsification_conditions: val.falsification_conditions, veto_items: uniqueVeto,
    verified_evidence: evidence.verified, rejected_evidence: evidence.rejected,
    unknowns, review_summaries: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, reviews[dimension].summary ?? ""])),
  };
}

function rejected(row, index, ticker, errors, normalized) {
  return { rowIndex: row.rowIndex ?? index, ticker, valid: false, validationStatus: "rejected", normalized, errors };
}

function ranking(rows) {
  return rows.filter((row) => row.decision_eligible).sort((a, b) =>
    (CONFIDENCE[b.confidence] - CONFIDENCE[a.confidence]) || (b.overall_score - a.overall_score) ||
    (b.component_scores.business_model - a.component_scores.business_model) || (b.component_scores.moat - a.component_scores.moat) ||
    (b.component_scores.financial_quality - a.component_scores.financial_quality) || (b.component_scores.valuation_opportunity_cost - a.component_scores.valuation_opportunity_cost) || a.ticker.localeCompare(b.ticker)
  ).map((row, index) => ({ rank: index + 1, ticker: row.ticker, overall_score: row.overall_score, confidence: row.confidence, decision: row.decision }));
}

export function mergeResults(payload) {
  if (!Array.isArray(payload?.rows)) throw new Error("输入必须是 LoomLoom result-rows 完整响应");
  const rows = payload.rows.map(mergeRow);
  const rejectedRows = rows.filter(({ valid }) => !valid).length;
  return { schemaVersion: "loomloom-us-value-local-audit/v1", valid: rejectedRows === 0, summary: { totalRows: rows.length, acceptedRows: rows.length - rejectedRows, rejectedRows, decisionEligibleRows: rows.filter(({ decision_eligible }) => decision_eligible).length }, ranking: ranking(rows), rows };
}

async function readText(path) {
  if (path !== "-") return readFile(path, "utf8");
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) return process.stdout.write("node scripts/merge-public-results.mjs --input <result-rows.json|-> [--output audit.json] [--pretty]\n");
  if (!args.input) throw new Error("必须提供 --input");
  const report = mergeResults(JSON.parse(await readText(args.input)));
  const output = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.output) await writeFile(args.output, output, "utf8"); else process.stdout.write(output);
  process.exitCode = report.valid ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`本地审计错误：${error.message}\n`); process.exitCode = 2; });

