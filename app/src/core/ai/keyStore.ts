/**
 * API Key 的本地存取。
 *
 * 说清楚一件事：**这不是加密，只是混淆。** 纯前端没有任何地方能安全保存密钥——
 * 只要密钥要能被浏览器用，它就必须能被浏览器读出来。这里的 XOR+Base64 只是
 * 防止「打开 DevTools 一眼看到 sk-xxx」，不防有心人。
 *
 * 真要安全只有一条路：云函数代理（settings.mode = 'proxy'），
 * 密钥只存在云函数环境变量里，前端连碰都碰不到。
 */

const MASK = 'ni-guide-2026';

function xorB64(input: string, encode: boolean): string {
  if (!input) return '';
  const mask = new TextEncoder().encode(MASK);
  let bytes: Uint8Array;
  if (encode) {
    bytes = new TextEncoder().encode(input);
  } else {
    const bin = atob(input);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i % mask.length] as number;
  if (!encode) return new TextDecoder().decode(bytes);

  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function obfuscate(key: string): string {
  return xorB64(key.trim(), true);
}

export function deobfuscate(cipher: string | null): string {
  if (!cipher) return '';
  try {
    return xorB64(cipher, false);
  } catch {
    return '';
  }
}

/** 只显示后 4 位，用于设置页回显 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 5)}••••${key.slice(-4)}`;
}
