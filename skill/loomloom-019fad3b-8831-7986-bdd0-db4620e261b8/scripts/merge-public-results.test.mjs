import test from "node:test";
import assert from "node:assert/strict";
import { mergeResults } from "./merge-public-results.mjs";
import { renderReport } from "./render-report.mjs";

const input = {
  identityPacket: { ticker: "AAPL", companyName: "Apple Inc.", fiscalPeriod: "FY2025", dataAsOf: "2026-07-29" },
  financialPacket: { marketSnapshot: { price: 200, currency: "USD", asOf: "2026-07-29" }, metrics: { revenue: 100, fcf: 20, debt: 10, pe: 25 } },
  qualitativePacket: {},
};

function ev(claim, source_ref, source_value) { return [{ claim, source_ref, source_value, period: "FY2025", unit: "USD" }]; }

function reviews() {
  return [
    { business_model_score: 80, understandability_score: 80, circle_of_competence: "pass", evidence_records: ev("收入", "financialPacket.metrics.revenue", 100), positive_points: [], contrary_points: [], unknowns: [], summary: "商业模式清晰" },
    { moat_score: 80, management_culture_score: 80, capital_allocation_score: 80, evidence_records: ev("现金流", "financialPacket.metrics.fcf", 20), positive_points: [], contrary_points: [], governance_red_flags: [], unknowns: [], summary: "护城河稳定" },
    { financial_quality_score: 80, cash_flow_quality_score: 80, balance_sheet_score: 80, evidence_records: ev("债务", "financialPacket.metrics.debt", 10), positive_points: [], contrary_points: [], accounting_red_flags: [], survival_risks: [], unknowns: [], summary: "财务质量良好" },
    {
      valuation_score: 80, margin_of_safety_score: 80, judgment_state: "eligible_for_manual_deep_research",
      evidence_records: ev("市盈率", "financialPacket.metrics.pe", 25),
      validity_basis: [
        { claim: "价格", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-07-29", unit: "USD" },
        { claim: "财报期间", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text" },
      ],
      falsification_conditions: [
        { condition: "价格变化", source_ref: "financialPacket.marketSnapshot.price", source_value: 200, period: "2026-07-29", unit: "USD", action: "rerun_required" },
        { condition: "财报更新", source_ref: "identityPacket.fiscalPeriod", source_value: "FY2025", period: "FY2025", unit: "text", action: "conclusion_invalidated" },
      ],
      positive_points: [], contrary_points: [], valuation_red_flags: [], forbidden_numeric_claims: [], unknowns: [], summary: "估值可继续研究",
    },
  ];
}

function payload({ fenced = false, mutate } = {}) {
  const outputs = reviews();
  mutate?.(outputs);
  return { rows: [{
    rowIndex: 0,
    status: "completed",
    inputJson: JSON.stringify(Object.fromEntries(Object.entries(input).map(([key, value]) => [key, JSON.stringify(value)]))),
    artifacts: outputs.map((value, index) => ({ opaqueId: `artifact-${index}`, inlineText: fenced ? `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` : JSON.stringify(value) })),
  }] };
}

test("identifies public output dimensions by shape without private step IDs", () => {
  const report = mergeResults(payload());
  assert.equal(report.valid, true);
  assert.equal(report.rows[0].overall_score, 80);
  assert.equal(report.rows[0].decision, "deep_research");
  assert.equal(report.rows[0].decision_eligible, true);
  assert.equal(report.rows[0].verified_evidence.length, 4);
  assert.equal(report.rows[0].price, 200);
});

test("normalizes fenced JSON", () => {
  const report = mergeResults(payload({ fenced: true }));
  assert.equal(report.rows[0].validationStatus, "normalized");
});

test("normalizes fenced JSON with trailing junk after closing fence", () => {
  const p = payload({ fenced: true });
  // Simulate cloud returning a stray backtick after the closing fence
  p.rows[0].artifacts = p.rows[0].artifacts.map((a, i) =>
    i === 1 ? { ...a, inlineText: a.inlineText + "\n`" } : a
  );
  const report = mergeResults(p);
  assert.equal(report.rows[0].validationStatus, "normalized");
  assert.equal(report.rows[0].valid, true);
});

test("rejects source values that do not match input and vetoes missing dimension evidence", () => {
  const report = mergeResults(payload({ mutate: (outputs) => { outputs[0].evidence_records[0].source_value = 999; } }));
  assert.equal(report.rows[0].decision, "pass");
  assert.ok(report.rows[0].veto_items.includes("missing_verified_evidence_business"));
});

test("rejects a missing research dimension", () => {
  const report = mergeResults(payload({ mutate: (outputs) => outputs.pop() }));
  assert.equal(report.valid, false);
  assert.equal(report.rows[0].validationStatus, "rejected");
});

test("detects unauthorized numeric target price", () => {
  const report = mergeResults(payload({ mutate: (outputs) => { outputs[3].summary = "目标价为 250 美元"; } }));
  assert.equal(report.rows[0].decision, "pass");
  assert.ok(report.rows[0].veto_items.includes("forbidden_numeric_claims"));
});

test("renders price, evidence and falsification conditions", () => {
  const markdown = renderReport(mergeResults(payload()));
  assert.match(markdown, /200 USD/);
  assert.match(markdown, /通过验证的证据/);
  assert.match(markdown, /价格变化/);
});

test("parses steps-format inputJson from cloud", () => {
  const stepsInputJson = JSON.stringify({
    steps: {
      stp_biz101: {
        prompt: `IDENTITY:\n${JSON.stringify(input.identityPacket)}\nFINANCIAL:\n${JSON.stringify(input.financialPacket)}\nQUALITATIVE:\n${JSON.stringify(input.qualitativePacket)}`,
      },
      stp_fin303: { prompt: "other step" },
    },
  });
  const p = payload();
  p.rows[0].inputJson = stepsInputJson;
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].ticker, "AAPL");
  assert.equal(report.rows[0].price, 200);
  assert.equal(report.rows[0].verified_evidence.length, 4);
});

test("accepts source_value containing derivation formula with original value", () => {
  const p = payload({ mutate: (outputs) => {
    // Cloud LLM writes a formula that includes the original value "80.0%"
    // Input value at qualitativePacket is {}, so test with a financial metric
    outputs[0].evidence_records[0].source_value = "100 / total = 100";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.equal(report.rows[0].verified_evidence.length, 4);
});

test("accepts string source_value that contains input value as substring", () => {
  const p = payload({ mutate: (outputs) => {
    // Input value is 100 (number), cloud writes "revenue was 100 million"
    outputs[0].evidence_records[0].source_value = "revenue was 100 million";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.ok(report.rows[0].verified_evidence.some((e) => e.claim === "收入"));
});

test("rejects source_value that does not contain input value at all", () => {
  const p = payload({ mutate: (outputs) => {
    outputs[0].evidence_records[0].source_value = "completely different value 999";
  }});
  const report = mergeResults(p);
  assert.equal(report.rows[0].decision, "pass");
  assert.ok(report.rows[0].veto_items.includes("missing_verified_evidence_business"));
});

test("accepts source_value that is the result of a formula in the input", () => {
  // Input value is "61166/76448 = 80.0%", cloud writes just "80.0%"
  const formulaInput = {
    identityPacket: { ticker: "TEST", companyName: "Test Corp", fiscalPeriod: "FY2025", dataAsOf: "2026-07-29" },
    financialPacket: { marketSnapshot: { price: 200, currency: "USD", asOf: "2026-07-29" }, metrics: { revenue: 100, fcf: 20, debt: 10, pe: 25, ratio: "61166/76448 = 80.0%" } },
    qualitativePacket: {},
  };
  const outputs = reviews();
  outputs[0].evidence_records = [{ claim: "负债率", source_ref: "financialPacket.metrics.ratio", source_value: "80.0%", period: "FY2025", unit: "text" }];
  const p = {
    rows: [{
      rowIndex: 0, status: "completed",
      inputJson: JSON.stringify(Object.fromEntries(Object.entries(formulaInput).map(([k, v]) => [k, JSON.stringify(v)]))),
      artifacts: outputs.map((v) => ({ opaqueId: "a", inlineText: JSON.stringify(v) })),
    }],
  };
  const report = mergeResults(p);
  assert.equal(report.rows[0].valid, true);
  assert.ok(report.rows[0].verified_evidence.some((e) => e.claim === "负债率"));
});

