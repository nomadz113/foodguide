/**
 * 种子库版本号。**单独成文件，因为它必须能被首屏静态 import。**
 *
 * 为什么从 seed.ts 里拆出来：seed.ts 是 1170 行、174 条数据（含 13 项微矿），
 * 是首屏主包里中文字符的绝大部分。但它只在**首次安装**和**种子版本升级**时才真正需要 ——
 * `repo.ensureSeed()` 绝大多数启动都在版本号相等且已有 preset 数据时直接 return 0。
 *
 * 而 ensureSeed 的早退判断又必须**同步拿到版本号**。把版本号留在 seed.ts 里，
 * 静态引用它就会把整个数据表拽进首屏。所以：版本号单独一块（几百字节），
 * 数据表由 ensureSeed 走到需要它的分支时再 `await import()`。
 *
 * 值不许随手改：一旦变更，所有已安装设备会在下次启动时重灌种子库（保留用户的
 * usageCount / personalBias / biasSamples，但营养数据与 aliases 会被种子值覆盖）。
 */
export const SEED_VERSION = 7;
