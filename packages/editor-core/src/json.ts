export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A document root as plain JSON, before grammar validation. */
export interface DocumentContent {
  type: 'doc';
  content?: JsonValue[];
  [key: string]: JsonValue | JsonValue[] | 'doc' | undefined;
}
