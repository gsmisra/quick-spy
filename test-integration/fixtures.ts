/**
 * Shared, side-effect-free fixture constants for the Extension Host
 * integration suite — imported by BOTH `runTest.ts` (to build the scratch
 * workspace BEFORE the Extension Host launches) and the actual test file
 * under `suite/` (which runs INSIDE that already-launched host). Kept
 * separate from `runTest.ts` itself so importing it can never accidentally
 * re-trigger that file's own top-level `main().catch(...)` call.
 */

export const ORDER_CALCULATOR_SOURCE_FILENAME = 'OrderCalculator.java';
export const ORDER_CALCULATOR_RECIPE_FILENAME = 'order-calculator-total-with-tax.md';
export const ORDER_CALCULATOR_RECIPE_ID = 'order-calculator-total-with-tax';

/** `totalWithTax` calls the same-file `applyTax` — its `sourceHash` (F09)
 * covers BOTH excerpts, so changing ONLY `applyTax`'s body (see the V2
 * variant below) must still mark `totalWithTax` stale. */
export const ORDER_CALCULATOR_JAVA_V1 = `package com.acme.testkit.util;

public class OrderCalculator {
  public double totalWithTax(double subtotal) {
    return applyTax(subtotal);
  }

  public double applyTax(double subtotal) {
    return subtotal * 1.08;
  }
}
`;

/** Only `applyTax`'s own body differs from V1 — every line of `totalWithTax`
 * is byte-for-byte identical. */
export const ORDER_CALCULATOR_JAVA_V2 = `package com.acme.testkit.util;

public class OrderCalculator {
  public double totalWithTax(double subtotal) {
    return applyTax(subtotal);
  }

  public double applyTax(double subtotal) {
    return subtotal * 1.10;
  }
}
`;
