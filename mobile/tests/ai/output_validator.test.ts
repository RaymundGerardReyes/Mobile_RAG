import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OutputValidator } from '../../src/ai/evaluation/output_validator.js';

describe('AI Evaluation: OutputValidator & Scoring Guardrails', () => {
  const allowedPassages = ['p001', 'p002'];

  it('Guardrail 1: intercepts malformed JSON and defaults to ambiguous with 0 confidence', () => {
    const invalidJson = 'Here is the verdict: { verdict: "equivalent", matched_concepts: ';
    const result = OutputValidator.validateFreeAnswer(invalidJson, allowedPassages);

    assert.equal(result.verdict, 'ambiguous');
    assert.equal(result.isCorrect, false);
    assert.equal(result.score, 0.0);
    assert.equal(result.confidence, 0.0);
    assert.equal(result.guardrailTriggered, 'MALFORMED_JSON');
    assert.equal(result.requiresManualReview, true);
  });

  it('Guardrail 1: intercepts schema violations (missing required fields)', () => {
    const incompleteJson = JSON.stringify({
      verdict: 'equivalent',
      confidence: 0.95,
      // missing matched_concepts, missing_concepts, evidence_passage_ids
    });
    const result = OutputValidator.validateFreeAnswer(incompleteJson, allowedPassages);

    assert.equal(result.verdict, 'ambiguous');
    assert.equal(result.guardrailTriggered, 'MALFORMED_JSON');
    assert.equal(result.requiresManualReview, true);
  });

  it('Guardrail 1: successfully parses JSON wrapped in markdown code fence', () => {
    const fencedJson = `
\`\`\`json
{
  "verdict": "equivalent",
  "matched_concepts": ["legislative power", "Congress"],
  "missing_concepts": [],
  "evidence_passage_ids": ["p001"],
  "confidence": 0.92
}
\`\`\`
    `;
    const result = OutputValidator.validateFreeAnswer(fencedJson, allowedPassages);

    assert.equal(result.verdict, 'equivalent');
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1.0);
    assert.equal(result.confidence, 0.92);
    assert.equal(result.guardrailTriggered, null);
    assert.equal(result.requiresManualReview, false);
  });

  it('Guardrail 2: intercepts hallucinated evidence passage IDs', () => {
    const hallucinatedJson = JSON.stringify({
      verdict: 'equivalent',
      matched_concepts: ['merit and fitness'],
      missing_concepts: [],
      evidence_passage_ids: ['p999_invented'], // Not in allowedPassages!
      confidence: 0.90,
    });
    const result = OutputValidator.validateFreeAnswer(hallucinatedJson, allowedPassages);

    assert.equal(result.verdict, 'ambiguous');
    assert.equal(result.isCorrect, false);
    assert.equal(result.score, 0.0);
    assert.equal(result.guardrailTriggered, 'HALLUCINATED_EVIDENCE');
    assert.equal(result.requiresManualReview, true);
  });

  it('Guardrail 3: intercepts low confidence (< 0.75) and forces manual review', () => {
    const lowConfidenceJson = JSON.stringify({
      verdict: 'equivalent',
      matched_concepts: ['civil service'],
      missing_concepts: [],
      evidence_passage_ids: ['p001'],
      confidence: 0.65, // Below 0.75 threshold
    });
    const result = OutputValidator.validateFreeAnswer(lowConfidenceJson, allowedPassages);

    assert.equal(result.verdict, 'ambiguous');
    assert.equal(result.isCorrect, false);
    assert.equal(result.score, 0.0);
    assert.equal(result.guardrailTriggered, 'LOW_CONFIDENCE');
    assert.equal(result.requiresManualReview, true);
  });

  it('Guardrail 4: correctly maps partially_equivalent verdict to 0.5 score', () => {
    const partialJson = JSON.stringify({
      verdict: 'partially_equivalent',
      matched_concepts: ['Senate'],
      missing_concepts: ['House of Representatives'],
      evidence_passage_ids: ['p001'],
      confidence: 0.88,
    });
    const result = OutputValidator.validateFreeAnswer(partialJson, allowedPassages);

    assert.equal(result.verdict, 'partially_equivalent');
    assert.equal(result.isCorrect, false);
    assert.equal(result.score, 0.5);
    assert.equal(result.requiresManualReview, false);
  });

  it('Guardrail 4: correctly maps incorrect verdict to 0.0 score', () => {
    const incorrectJson = JSON.stringify({
      verdict: 'incorrect',
      matched_concepts: [],
      missing_concepts: ['Judicial branch', 'Supreme Court'],
      evidence_passage_ids: ['p002'],
      confidence: 0.95,
    });
    const result = OutputValidator.validateFreeAnswer(incorrectJson, allowedPassages);

    assert.equal(result.verdict, 'incorrect');
    assert.equal(result.isCorrect, false);
    assert.equal(result.score, 0.0);
    assert.equal(result.requiresManualReview, false);
  });

  it('recovers gracefully from trailing commas emitted by quantized models', () => {
    const jsonWithTrailingCommas = `
      {
        "verdict": "equivalent",
        "matched_concepts": ["legislative power",],
        "missing_concepts": [],
        "evidence_passage_ids": ["p001",],
        "confidence": 0.95,
      }
    `;
    const result = OutputValidator.validateFreeAnswer(jsonWithTrailingCommas, allowedPassages);

    assert.equal(result.verdict, 'equivalent');
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1.0);
    assert.equal(result.confidence, 0.95);
    assert.equal(result.guardrailTriggered, null);
  });

  it('strictly rejects injected additional properties not in contract schema', () => {
    const injectedJson = JSON.stringify({
      verdict: 'equivalent',
      matched_concepts: ['test'],
      missing_concepts: [],
      evidence_passage_ids: ['p001'],
      confidence: 0.95,
      system_override: true, // Injected extra property
    });
    const result = OutputValidator.validateFreeAnswer(injectedJson, allowedPassages);

    assert.equal(result.verdict, 'ambiguous');
    assert.equal(result.guardrailTriggered, 'MALFORMED_JSON');
    assert.equal(result.requiresManualReview, true);
  });

  it('rejects non-string items within concept and passage arrays', () => {
    const invalidItemTypes = JSON.stringify({
      verdict: 'equivalent',
      matched_concepts: [123, null], // Non-string items!
      missing_concepts: [],
      evidence_passage_ids: ['p001'],
      confidence: 0.95,
    });
    const result = OutputValidator.validateFreeAnswer(invalidItemTypes, allowedPassages);

    assert.equal(result.verdict, 'ambiguous');
    assert.equal(result.guardrailTriggered, 'MALFORMED_JSON');
    assert.equal(result.requiresManualReview, true);
  });
});

