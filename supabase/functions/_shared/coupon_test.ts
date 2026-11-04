import { assertEquals } from "jsr:@std/assert@1";
import { discounted, normalizeCode } from "./coupon.ts";

Deno.test("normalizeCode trims and uppercases", () => {
  assertEquals(normalizeCode("  vull-20 "), "VULL-20");
});

Deno.test("normalizeCode rejects what can't be a code", () => {
  for (const raw of ["", "ab", "con espacio", "ñandu", "A".repeat(33), null, 20, undefined]) {
    assertEquals(normalizeCode(raw), null);
  }
});

Deno.test("discounted applies the percent", () => {
  assertEquals(discounted(1000, 20), 800);
  assertEquals(discounted(45000, 15), 38250);
});

Deno.test("discounted rounds to whole pesos", () => {
  assertEquals(discounted(999, 15), 849); // 849.15
  assertEquals(discounted(1001, 50), 501); // 500.5
});

Deno.test("discounted never reaches zero", () => {
  assertEquals(discounted(1, 99), 1);
});
