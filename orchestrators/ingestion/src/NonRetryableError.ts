// Cloudflare Workflows, and the local simulator alike, stop retrying a step the
// moment it throws an error named `NonRetryableError`. Alchemy does not wrap
// that, so a defect carrying the name is how an Effect step opts out.
//
// It never travels the failure channel: it is only ever thrown as a defect at
// the step boundary, where Cloudflare reads the native `name`.
// @effect-diagnostics-next-line extendsNativeError:off
export class NonRetryableError extends Error {
  override readonly name = 'NonRetryableError';

  constructor(message: string, options?: { readonly cause: unknown }) {
    super(message, options);
  }
}
