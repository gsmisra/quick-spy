/**
 * Minimal ambient typing for `mammoth` — it ships no TypeScript types of
 * its own and no `@types/mammoth` package exists on npm. Declares only the
 * one function docxIngestion.ts actually calls (`convertToMarkdown`), not
 * mammoth's full API surface.
 */
declare module 'mammoth' {
  export interface MammothInput {
    buffer: Buffer;
  }

  export interface MammothResult {
    value: string;
    messages: unknown[];
  }

  export function convertToMarkdown(input: MammothInput): Promise<MammothResult>;
}
