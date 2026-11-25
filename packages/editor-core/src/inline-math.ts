/**
 * `$latex$` runs in prose. Deliberately conservative: the delimiters must hug
 * non-space content and neither `$` may touch a digit, so currency ("$5 and
 * $10") is never read as math; an escaped dollar is always literal. A factory
 * because the regex is stateful.
 */
export const RICH_INLINE_MATH_PATTERN = (): RegExp =>
  /(?<![\\\d$])\$(?=\S)([^$\n]+?)(?<=[^\s\\])\$(?![\d$])/g;
