# Security Policy

## Reporting a vulnerability

Please report security issues **privately**, through GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**. Do not open a public issue for a vulnerability.

Include what you found, how to reproduce it (a sample document or plugin is ideal), the K-Doc version and your
Windows version. You can expect an acknowledgement within a week. Fixes are released as soon as they are ready,
and reporters are credited in the release notes unless they ask not to be.

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## What K-Doc trusts, and what it does not

K-Doc is a desktop application: its webview can ask the Rust host to read and write files, so anything that runs
script in the webview could act with your user account's permissions. The design draws these lines.

**Documents are untrusted.** You may open Markdown, HTML, RTF or DOCX files from anywhere.

- Raw HTML in a document is kept in the file exactly as written, but everything K-Doc *renders* from it
  (Presentation, Print, the track-changes Original view, HTML export) passes through an allow-list sanitiser that
  removes scripts, event handlers, `javascript:` links, forms, foreign frames and similar.
- The WYSIWYG view never turns raw HTML into live elements: it shows it as source.
- The application runs under a Content Security Policy that forbids inline script and `eval`, and the window
  cannot be navigated to any page outside K-Doc.
- The host only touches files you chose: every file command checks a list of the files and folders you
  opened, saved, dropped or picked, and a link to any other file asks first ("Allow access?"). So even script
  that somehow ran in the window could not read or write anything else.
- Links open through K-Doc's own handling: web addresses only after the checks in Settings, and only `http`,
  `https` and `mailto` are handed to the operating system.
- Video embeds are limited to YouTube (privacy-enhanced mode) and Vimeo, and nothing is fetched until you press
  Play. Remote (http/https) images referenced by a document are loaded when it is shown; images on network
  file shares (`\\server\share`) are refused, so opening a document never makes Windows authenticate elsewhere.

**Plugins are trusted code.** A plugin runs in a Web Worker with network, storage and peer-connection APIs removed, and it can only
register commands and syntax through a validated message protocol. That sandbox limits accidents, not a determined
attacker: install plugins only from authors you trust, as you would any other software.

**Themes are trusted.** User and export themes are CSS files you place in K-Doc's themes folders; a theme can change
how anything looks, including K-Doc's own dialogs.

**Git repositories are trusted when you use the Git features.** Version History, Stage and Commit run the `git`
installed on your machine in the document's folder. K-Doc disables the repository's `core.fsmonitor` command so
merely reading history never runs it, but other repository settings (clean filters, and hooks when you commit) are
honoured exactly as `git` itself honours them. Do not use the Git features in a repository you do not trust.

**Optional network features** are off until you use them: the grammar checker sends the document text only to the
endpoint you configure, and only when you run **Check Grammar**; that endpoint must use https unless it runs on your
computer or local network; additional spell-check dictionaries are
downloaded from the `wooorm/dictionaries` project on GitHub only after you confirm.
