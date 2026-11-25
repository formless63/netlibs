import { describe, expect, it } from 'bun:test';

import {
  formatRichFileSize,
  richFileDownloadName,
  richFileExtensionLabel
} from '../src/file-card.ts';

describe('richFileExtensionLabel', () => {
  it('derives an uppercase extension chip from a filename-shaped title', () => {
    expect(richFileExtensionLabel('invoice.pdf')).toBe('PDF');
    expect(richFileExtensionLabel('firmware-bundle.zip')).toBe('ZIP');
    expect(richFileExtensionLabel('archive.tar.gz')).toBe('GZ');
    expect(richFileExtensionLabel('  spaced.XLSX  ')).toBe('XLSX');
  });

  it('falls back to FILE when there is no usable extension', () => {
    expect(richFileExtensionLabel('Quarterly export')).toBe('FILE');
    expect(richFileExtensionLabel('')).toBe('FILE');
    expect(richFileExtensionLabel('no-extension.')).toBe('FILE');
    // Trailing segment too long to plausibly be an extension.
    expect(richFileExtensionLabel('sentence.ending in a word')).toBe('FILE');
  });
});

describe('richFileDownloadName ', () => {
  it('hands the browser the filename WITH its extension when the title has one', () => {
    expect(richFileDownloadName('Shelf label - rev 2.dat')).toBe(
      'Shelf label - rev 2.dat'
    );
    expect(richFileDownloadName('invoice.pdf')).toBe('invoice.pdf');
    expect(richFileDownloadName('  spaced.XLSX  ')).toBe('spaced.XLSX');
  });

  it('withholds the attribute entirely for an extension-less title', () => {
    // A `download` value with no extension makes the browser append one from the MIME type. Without
    // it, the server's Content-Disposition filename wins.
    expect(richFileDownloadName('Quarterly export')).toBeNull();
    expect(richFileDownloadName('')).toBeNull();
    expect(richFileDownloadName('   ')).toBeNull();
    expect(richFileDownloadName('no-extension.')).toBeNull();
    expect(richFileDownloadName('sentence.ending in a word')).toBeNull();
  });

  it('agrees with the extension chip about what counts as an extension', () => {
    // One notion of "has a usable extension" across the card's chip and its
    // save-as hint — they must not disagree about the same title.
    for (const title of ['invoice.pdf', 'Quarterly export', 'no-extension.', 'label.dat']) {
      expect(richFileDownloadName(title) === null).toBe(
        richFileExtensionLabel(title) === 'FILE'
      );
    }
  });
});

describe('formatRichFileSize', () => {
  it('formats bytes into a human-readable size', () => {
    expect(formatRichFileSize(0)).toBe('0 B');
    expect(formatRichFileSize(512)).toBe('512 B');
    expect(formatRichFileSize(2048)).toBe('2 KB');
    expect(formatRichFileSize(45_875)).toBe('44.8 KB');
    expect(formatRichFileSize(253_337)).toBe('247 KB');
    expect(formatRichFileSize(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatRichFileSize(3.4 * 1024 * 1024 * 1024)).toBe('3.4 GB');
  });

  it('returns null for unavailable or nonsensical input', () => {
    expect(formatRichFileSize(null)).toBeNull();
    expect(formatRichFileSize(undefined)).toBeNull();
    expect(formatRichFileSize(-1)).toBeNull();
    expect(formatRichFileSize(Number.NaN)).toBeNull();
  });
});
