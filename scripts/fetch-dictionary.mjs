#!/usr/bin/env node

/**
 * @file fetch-dictionary.mjs
 * @purpose Downloads Hunspell dictionary assets (index.aff and index.dic) for offline spell checking into packages/app/public/dictionaries/<lang>/ (FR-12.1).
 * @inputs Command-line argument for language tag (optional, defaults to 'en-GB'); HTTP responses from raw.githubusercontent.com/wooorm/dictionaries.
 * @outputs Downloaded index.aff and index.dic files written to disk; status messages and byte sizes logged to console.
 * @functions
 *   - fetchFile: Issues an HTTP GET request to download a single dictionary asset as a Buffer.
 *   - main: CLI entrypoint parsing arguments, validating language codes, creating target directories, and downloading dictionary assets.
 * @dataflow CLI argument -> validated language tag -> construct remote URLs -> global fetch -> Buffer -> fs/promises writeFile to disk -> stdout confirmation.
 * @controlflow Parse process.argv -> validate language code against regex -> resolve repository-relative paths -> create target directory -> download index.aff and index.dic -> write files to disk -> log diagnostics.
 * @version 2
 * @date 2026-10-07
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';

/**
 * Base URL for wooorm/dictionaries raw assets on GitHub.
 */
const DICTIONARY_BASE_URL = 'https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries';

/**
 * List of dictionary file names required by Hunspell.
 */
const DICTIONARY_FILES = ['index.aff', 'index.dic', 'license'];

/**
 * Regular expression validating language tag format (e.g. "en-GB", "en-US", "fr").
 */
const LANGUAGE_CODE_REGEX = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/**
 * Fetches a single remote file from the dictionary repository.
 * @purpose Issues an HTTP GET request for a dictionary file and returns its body as a Buffer.
 * @inputs url - Fully qualified HTTP URL of the asset to download.
 * @outputs Promise<Buffer> - The downloaded file content buffer.
 * @dataflow Remote URL string -> global fetch -> Response -> ArrayBuffer -> Buffer.from.
 * @controlflow Perform HTTP GET -> inspect response.ok -> exit 1 on non-OK status -> convert to Buffer -> return.
 */
async function fetchFile(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    // Check whether the caught error is an instance of Error.
    const message = error instanceof Error ? error.message : String(error);
    // Network or DNS failure occurred: log error message and terminate with exit code 1.
    console.error(`Network error requesting ${url}: ${message}`);
    process.exit(1);
  }

  // Check whether the HTTP response status code indicates success (HTTP 200-299).
  if (!response.ok) {
    // Response status is non-OK: exit 1 naming the status and the URL.
    console.error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
    process.exit(1);
  } else {
    // Response status is OK: proceed to read binary payload.
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Main execution function orchestrating dictionary downloading.
 * @purpose Parses CLI argument, validates language tag, ensures directory exists, and writes dictionary files.
 * @inputs None (reads process.argv).
 * @outputs Promise<void>.
 * @dataflow process.argv[2] -> validated language -> targetDir path -> fetchFile -> writeFile -> stdout logs.
 * @controlflow Determine language -> validate regex -> resolve target path -> mkdir recursive ->
 *   iterate files -> fetch and write each file -> print file paths and byte sizes -> print clone reminder.
 */
async function main() {
  const rawLang = process.argv[2];
  let lang = 'en-GB';

  // Check whether an explicit language argument was provided on the command line.
  if (rawLang !== undefined && rawLang !== '') {
    // Argument supplied: adopt the user-specified language code.
    lang = rawLang;
  } else {
    // No argument supplied: fall back to the default 'en-GB'.
    lang = 'en-GB';
  }

  // Check whether the language argument matches the strict language tag format.
  // The argument is interpolated into a URL, so it is validated rather than trusted.
  if (!LANGUAGE_CODE_REGEX.test(lang)) {
    // Invalid language code: report error and exit 1.
    console.error(`Invalid language code "${lang}". Language must match /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/ (e.g. "en-GB", "en-US", "fr").`);
    process.exit(1);
  } else {
    // Valid language code: proceed with downloading.
  }

  // Resolve the destination relative to the script's own location rather than process.cwd().
  // A script that only works from the repository root is a script that fails in a hook.
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptDir = dirname(scriptPath);
  const repoRoot = resolve(scriptDir, '..');
  const targetDir = resolve(repoRoot, 'packages', 'app', 'public', 'dictionaries', lang);

  // Ensure target directory exists before writing files into it.
  await mkdir(targetDir, { recursive: true });

  // Download and write each required dictionary file.
  for (const filename of DICTIONARY_FILES) {
    const fileUrl = `${DICTIONARY_BASE_URL}/${lang}/${filename}`;
    const fileBuffer = await fetchFile(fileUrl);
    const destPath = resolve(targetDir, filename);

    // If the files already exist, still overwrite.
    // Re-running to pick up an updated dictionary is the obvious reason to run it twice,
    // and a script that refuses is more annoying than one that repeats work.
    await writeFile(destPath, fileBuffer);

    // Print the destination path and the byte size of each file.
    console.log(`${destPath} (${fileBuffer.byteLength} bytes)`);
  }

  // Print a one-line reminder that the dictionary is not committed and each clone needs this run.
  console.log('Reminder: Dictionary files are not committed to git; each clone needs this run.');
}

await main();
