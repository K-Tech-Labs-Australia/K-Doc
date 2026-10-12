/**
 * @file grammar-service.ts
 * @purpose Asks a LanguageTool-compatible service what is wrong with a document's prose (FR-12.4). Nothing here runs unless the reader has named a service and asked for a check: the text of their document is sent to whatever address they gave, and that is not something to do on a timer or by default;
 * @inputs the service address, the text to check and the language to check it as;
 * @outputs the issues the service reported;
 * @functions checkGrammar;
 * @dataflow text -> a form-encoded POST to <endpoint> -> JSON -> parseGrammarResponse -> issues;
 * @controlflow a service that is unreachable, slow, or answers with something that is not a check result is reported as a failure the caller shows, never as "no problems found", which would be a lie the reader would act on;
 * @version 1
 * @date 2026-09-16
 */

import { parseGrammarResponse, type GrammarIssue } from '@k-doc/core';

/**
 * @purpose The parameters required to run a single grammar check against a LanguageTool-compatible service.
 * @inputs endpoint - URL of the grammar service; text - document prose to check; language - code to check as (empty means auto); signal - optional AbortSignal for cancellation; fetchImpl - optional fetch override so the service can be tested without a network, never passed by app code.
 * @outputs N/A — this is a parameter object consumed by checkGrammar(), not a value it returns.
 * @dataflow The caller constructs one of these and passes it to checkGrammar().
 * @controlflow N/A — no control flow; the shape is fixed entirely by its fields.
 */
export interface GrammarRequest {
  readonly endpoint: string;
  readonly text: string;
  readonly language: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

/**
 * @purpose Default timeout in milliseconds for a grammar check request, named so callers that want to abort have a value rather than a magic number.
 * @inputs N/A — module-level constant read by callers who build their own AbortController.
 * @outputs N/A — consumed as the delay passed to setTimeout or an AbortController's abort timing; never used internally here.
 * @dataflow Constant → caller's timeout logic (the signal is always the caller's to make).
 * @controlflow N/A — no control flow; a named limit so timeouts are not magic numbers.
 */
export const GRAMMAR_TIMEOUT_MS: number = 20000;

/**
 * @purpose Upper bound on document length accepted in a single grammar request, enforced before any network call so an oversized document fails fast instead of hanging.
 * @inputs N/A — module-level constant read by checkGrammar() when comparing against request.text.length.
 * @outputs N/A — consumed in the refusal comparison; never sent to the service as-is.
 * @dataflow Constant → length comparison in checkGrammar() → refusal message stating the limit.
 * @controlflow N/A — no control flow; a named limit so the refusal is self-documenting rather than a bare literal.
 */
export const MAX_GRAMMAR_TEXT: number = 60000;

/**
 * @purpose Sends document prose to a LanguageTool-compatible grammar service and returns the issues it reports.
 * @inputs request.endpoint - service URL; request.text - prose to check; request.language - code to check as (empty means auto); request.signal - optional abort handle; request.fetchImpl - optional fetch override for testing.
 * @outputs The list of grammar issues reported by the service, or a thrown Error on any failure.
 * @dataflow text → a form-encoded POST to <endpoint> → JSON → parseGrammarResponse → issues.
 * @controlflow Refuse an empty endpoint before assembling anything; reject oversized text; POST the request; treat unreachable, non-2xx, and non-JSON responses as failures rather than "no problems found".
 */
/**
 * Whether document text may be sent to a grammar endpoint.
 *
 * @purpose Keeps document text off unencrypted connections to the internet.
 * @inputs endpoint - The configured service URL.
 * @outputs boolean - True for https, and for http on localhost, a loopback address, a private LAN range or a .local name.
 * @dataflow endpoint -> URL parse -> protocol and hostname checks -> verdict.
 * @controlflow An unparseable URL is refused; https is allowed; http only for local hosts; anything else is refused.
 */
export function isAllowedGrammarEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    // Not a URL at all: nothing can be sent to it.
    return false;
  }
  // Encrypted connections may go anywhere the user chose.
  if (url.protocol === 'https:') {
    return true;
  } else if (url.protocol !== 'http:') {
    // Neither https nor http (file:, data:, ...): refuse.
    return false;
  } else {
    // Plain http: allowed only for hosts that never leave this machine or the local network.
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Loopback names and addresses, and mDNS .local names on the LAN.
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || /^127\./.test(host)) {
    return true;
  } else {
    // Otherwise only the private IPv4 ranges (RFC 1918) count as local.
  }
  return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export async function checkGrammar(request: GrammarRequest): Promise<readonly GrammarIssue[]> {
  const endpoint = request.endpoint.trim();
  // Refuse an unnamed service before assembling anything, so document text is never sent to a service that was never named.
  if (endpoint.length === 0) {
    throw new Error('No grammar service is set. Add one in Settings under Proofing.');
  } else {
    // Endpoint present: nothing to do here because the failure case already returned above.
  }

  // Document text is only ever sent encrypted, or to a server on this machine or the local network.
  if (!isAllowedGrammarEndpoint(endpoint)) {
    throw new Error(
      'The grammar service must use https, unless it runs on this computer or your local network. Change it in Settings under Proofing.',
    );
  } else {
    // An https endpoint, or http on a local address: carry on.
  }

  // Reject an oversized document up front so a request that would hang or be refused fails fast with a clear message.
  if (request.text.length > MAX_GRAMMAR_TEXT) {
    throw new Error(
      `This document is too long to check in one request (${request.text.length.toLocaleString()} characters; the limit is ${MAX_GRAMMAR_TEXT.toLocaleString()}).`,
    );
  } else {
    // Text within the limit: nothing to do here because the failure case already returned above.
  }

  const body = new URLSearchParams();
  body.set('text', request.text);
  body.set('language', request.language.length === 0 ? 'auto' : request.language);

  const send = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await send(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The grammar service could not be reached. ${reason}`);
  }

  // A non-2xx status means the service rejected or failed the request; surface it rather than treating it as success.
  if (!response.ok) {
    throw new Error(`The grammar service answered ${response.status}.`);
  } else {
    // Response is a success: nothing to do here because the failure case already returned above.
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The grammar service answered with something that is not a check result.');
  }

  return parseGrammarResponse(payload, request.text.length);
}
