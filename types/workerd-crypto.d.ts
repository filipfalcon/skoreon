// workerd provides the Web Crypto and Encoding globals, but with no
// @cloudflare/workers-types and `lib: ["esnext"]` nothing declares them. A
// narrow declaration of what the code uses is preferred over widening the
// workers to the whole DOM lib.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
};

declare class TextEncoder {
  encode(input: string): Uint8Array;
}
