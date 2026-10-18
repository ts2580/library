export const PASSWORD_BYTE_LIMIT = 72;
export const PASSWORD_BYTE_MESSAGE = "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다. (한글은 보통 1자당 3바이트)";

export function fitsBcrypt(password: string): boolean {
  return new TextEncoder().encode(password).length <= PASSWORD_BYTE_LIMIT;
}
