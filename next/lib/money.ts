/** Accept whole won amounts only; reject coercions such as -1000 -> 1000. */
export function isWonInput(value: string): boolean {
  const input = value.trim();
  if (input === "") return true;
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(input)) return false;
  return Number.isSafeInteger(Number(input.replaceAll(",", "")));
}

/** Call only after isWonInput succeeds. */
export function normalizeWonInput(value: string): string | null {
  if (!isWonInput(value)) throw new RangeError("가격은 0 이상의 정수 또는 올바른 천 단위 쉼표 형식이어야 합니다.");
  return value.trim().replaceAll(",", "") || null;
}
