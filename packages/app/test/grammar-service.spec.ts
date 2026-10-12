/**
 * @file grammar-service.spec.ts
 * @purpose Covers the grammar request (FR-12.4), and above all the promise that nothing is sent anywhere until the reader has named a service: the test that no fetch happens without one is the important test in this file.
 * @inputs A fake fetch implementation supplied via the `fetchImpl` argument.
 * @outputs Assertions over checkGrammar's resolved issues or thrown reasons.
 * @functions The describe block exercising every path of checkGrammar.
 * @dataflow a request -> the fake fetch -> the parsed issues, or a thrown reason.
 * @controlflow one it per way a service can fail (or succeed).
 * @version 1
 * @date 2026-09-16
 */

import { describe, expect, it } from 'vitest';
import { MAX_GRAMMAR_TEXT, checkGrammar, isAllowedGrammarEndpoint } from '../src/spell/grammar-service.js';

interface Call {
  readonly url: string;
  readonly body: string;
  readonly method: string;
}

function fakeFetch(result: { readonly ok?: boolean; readonly status?: number; readonly json?: unknown; readonly throws?: string }) {
  const calls: Call[] = [];
  const impl = ((url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: String(init.body), method: String(init.method) });
    // A fake network failure is thrown from the call itself, as a real one is.
    if (result.throws !== undefined) {
      return Promise.reject(new Error(result.throws));
    } else {
    }
    return Promise.resolve({
      ok: result.ok ?? true,
      status: result.status ?? 200,
      json: (): Promise<unknown> => {
        // A body that is not JSON rejects when it is read, not when it arrives.
        if (result.json === undefined) {
          return Promise.reject(new Error('not json'));
        } else {
          return Promise.resolve(result.json);
        }
      },
    } as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('checkGrammar', () => {
  // Guards the core promise: with no service named, nothing leaves the machine and the reader is told where to name one.
  it('sends nothing at all when no service is set', async () => {
    // The promise this feature rests on: with no service named, the document's text does not leave the
    // machine, and the reader is told where to name one.
    const { impl, calls } = fakeFetch({ json: { matches: [] } });
    await expect(checkGrammar({ endpoint: '', text: 'Some private text.', language: 'en-GB', fetchImpl: impl })).rejects.toThrow(
      'No grammar service is set',
    );
    await expect(checkGrammar({ endpoint: '   ', text: 'Some private text.', language: 'en-GB', fetchImpl: impl })).rejects.toThrow(
      'No grammar service is set',
    );
    expect(calls).toEqual([]);
  });

  // Guards that the request body carries the document text and language to the chosen service.
  it('sends the text and the language to the service it was given', async () => {
    const { impl, calls } = fakeFetch({ json: { matches: [] } });
    await checkGrammar({ endpoint: 'http://localhost:8081/v2/check', text: 'Hello there.', language: 'en-GB', fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:8081/v2/check');
    // A check is a POST: the document goes in the body. As a query string it would be logged by every
    // proxy between here and the service, and would be far too long besides.
    expect(calls[0]?.method).toBe('POST');
    const sent = new URLSearchParams(calls[0]?.body ?? '');
    expect(sent.get('text')).toBe('Hello there.');
    expect(sent.get('language')).toBe('en-GB');
  });

  // Guards that an empty language is translated into an 'auto' hint for the service.
  it('asks the service to work the language out when none is set', async () => {
    const { impl, calls } = fakeFetch({ json: { matches: [] } });
    await checkGrammar({ endpoint: 'http://localhost:8081/v2/check', text: 'Hello.', language: '', fetchImpl: impl });
    expect(new URLSearchParams(calls[0]?.body ?? '').get('language')).toBe('auto');
  });

  // Guards that matches are parsed back into issues with their replacements intact.
  it('returns what the service found', async () => {
    const { impl } = fakeFetch({
      json: { matches: [{ offset: 0, length: 5, message: 'Wrong.', rule: { id: 'R1' }, replacements: [{ value: 'Right' }] }] },
    });
    const issues = await checkGrammar({ endpoint: 'https://x/v2/check', text: 'Hello there.', language: 'en', fetchImpl: impl });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.replacements).toEqual(['Right']);
  });

  // Guards that oversized documents are refused before any fetch happens.
  it('refuses a document too long to check in one request', async () => {
    const { impl, calls } = fakeFetch({ json: { matches: [] } });
    const huge = 'x'.repeat(MAX_GRAMMAR_TEXT + 1);
    await expect(checkGrammar({ endpoint: 'https://x/v2/check', text: huge, language: 'en', fetchImpl: impl })).rejects.toThrow(
      'too long',
    );
    // Refused before anything is sent, rather than by a service that times out.
    expect(calls).toEqual([]);
  });

  // The service is told how long the text is, so an issue pointing past the end of it is dropped rather
  // than reaching the panel, where it would highlight a range the document does not have.
  it('drops an issue that points past the end of the text it sent', async () => {
    const { impl } = fakeFetch({
      json: { matches: [{ offset: 0, length: 3, message: 'Inside.' }, { offset: 2, length: 50, message: 'Past the end.' }] },
    });
    const issues = await checkGrammar({ endpoint: 'https://x/v2/check', text: 'Hi.', language: 'en', fetchImpl: impl });
    expect(issues.map((issue) => issue.message)).toEqual(['Inside.']);
  });

  // Guards that a thrown network error surfaces as a "could not be reached" reason.
  it('says so when the service cannot be reached', async () => {
    const { impl } = fakeFetch({ throws: 'connection refused' });
    await expect(checkGrammar({ endpoint: 'https://x/v2/check', text: 'Hi.', language: 'en', fetchImpl: impl })).rejects.toThrow(
      'could not be reached',
    );
  });

  // Guards that a non-2xx status is reported with its status code.
  it('says so when the service refuses the request', async () => {
    const { impl } = fakeFetch({ ok: false, status: 503, json: {} });
    await expect(checkGrammar({ endpoint: 'https://x/v2/check', text: 'Hi.', language: 'en', fetchImpl: impl })).rejects.toThrow('503');
  });

  // Guards that a body which is not JSON (and never an empty list) is rejected as "not a check result".
  it('says so when the answer is not a check result', async () => {
    // Never an empty list: that would read as "nothing wrong with your writing".
    const { impl } = fakeFetch({});
    await expect(checkGrammar({ endpoint: 'https://x/v2/check', text: 'Hi.', language: 'en', fetchImpl: impl })).rejects.toThrow(
      'not a check result',
    );
  });
});

describe('isAllowedGrammarEndpoint', () => {
  it('allows https anywhere', () => {
    expect(isAllowedGrammarEndpoint('https://api.languagetool.org/v2/check')).toBe(true);
  });

  it('allows plain http only on this machine or the local network', () => {
    for (const local of [
      'http://localhost:8081/v2/check',
      'http://127.0.0.1:8081/v2/check',
      'http://[::1]:8081/v2/check',
      'http://10.0.0.5/v2/check',
      'http://192.168.1.20:8081/v2/check',
      'http://172.16.0.9/v2/check',
      'http://172.31.255.1/v2/check',
      'http://nas.local:8081/v2/check',
    ]) {
      expect(isAllowedGrammarEndpoint(local), local).toBe(true);
    }
  });

  it('refuses plain http to the internet, look-alike ranges and non-web schemes', () => {
    for (const remote of [
      'http://api.languagetool.org/v2/check',
      'http://172.32.0.1/v2/check',
      'http://192.169.1.1/v2/check',
      'http://localhost.evil.example/v2/check',
      'file:///C:/x',
      'not a url',
    ]) {
      expect(isAllowedGrammarEndpoint(remote), remote).toBe(false);
    }
  });

  it('never sends document text to a refused endpoint', async () => {
    let called = false;
    const impl = async (): Promise<Response> => {
      called = true;
      return new Response('{}');
    };
    await expect(
      checkGrammar({ endpoint: 'http://api.languagetool.org/v2/check', text: 'Private.', language: 'en', fetchImpl: impl }),
    ).rejects.toThrow('must use https');
    expect(called).toBe(false);
  });
});
