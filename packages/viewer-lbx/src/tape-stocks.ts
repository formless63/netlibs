/**
 * Brother TZe tape stocks, for previewing a label on another cassette.
 *
 * Pairs, not two pickers: tape and ink are fixed together at manufacture, so a list
 * of real cassettes can only preview what can be printed. Part numbers are
 * Brother's published ones. Colours approximate the stock on a screen; clear tape
 * renders as if stuck to something white.
 *
 * A preview only: nothing is written to the file or remembered.
 */

export interface LbxTapeStock {
  /** Stable id used as the `<select>` value and the `data-lbx-stock` attribute. */
  id: string;
  /** Ink (foreground / printed dots) colour. */
  ink: string;
  /** Tape (background / bare stock) colour. */
  tape: string;
  /** Short human label, e.g. "White on black". */
  label: string;
  /**
   * Representative Brother part number for the combination. Several widths
   * (and matte/flexible/strong-adhesive variants) share a combination; the
   * number is the common 12mm laminated cassette, quoted so the row can be
   * verified against Brother's catalogue.
   */
  tze: string;
}

/** The file's own declared stock: the default. */
export const LBX_FILE_STOCK_ID = 'file';

/** White on black and black on white first, then grouped by tape colour. */
export const LBX_TAPE_STOCKS: readonly LbxTapeStock[] = [
  {
    id: 'white-on-black',
    ink: '#ffffff',
    tape: '#000000',
    label: 'White on black',
    tze: 'TZe-335',
  },
  { id: 'gold-on-black', ink: '#c9a227', tape: '#000000', label: 'Gold on black', tze: 'TZe-334' },
  {
    id: 'black-on-white',
    ink: '#000000',
    tape: '#ffffff',
    label: 'Black on white',
    tze: 'TZe-231',
  },
  { id: 'blue-on-white', ink: '#0057b8', tape: '#ffffff', label: 'Blue on white', tze: 'TZe-233' },
  { id: 'red-on-white', ink: '#c8102e', tape: '#ffffff', label: 'Red on white', tze: 'TZe-232' },
  {
    id: 'black-on-clear',
    ink: '#000000',
    tape: '#f4f4f4',
    label: 'Black on clear',
    tze: 'TZe-131',
  },
  {
    id: 'white-on-clear',
    ink: '#ffffff',
    tape: '#f4f4f4',
    label: 'White on clear',
    tze: 'TZe-135',
  },
  {
    id: 'black-on-yellow',
    ink: '#000000',
    tape: '#f2c800',
    label: 'Black on yellow',
    tze: 'TZe-631',
  },
  { id: 'black-on-red', ink: '#000000', tape: '#c8102e', label: 'Black on red', tze: 'TZe-431' },
  { id: 'white-on-red', ink: '#ffffff', tape: '#c8102e', label: 'White on red', tze: 'TZe-435' },
  { id: 'black-on-blue', ink: '#000000', tape: '#0057b8', label: 'Black on blue', tze: 'TZe-531' },
  { id: 'white-on-blue', ink: '#ffffff', tape: '#0057b8', label: 'White on blue', tze: 'TZe-535' },
  {
    id: 'black-on-green',
    ink: '#000000',
    tape: '#00843d',
    label: 'Black on green',
    tze: 'TZe-731',
  },
  {
    id: 'white-on-green',
    ink: '#ffffff',
    tape: '#00843d',
    label: 'White on green',
    tze: 'TZe-735',
  },
  {
    id: 'black-on-silver',
    ink: '#000000',
    tape: '#c0c0c0',
    label: 'Black on silver',
    tze: 'TZe-921',
  },
  {
    id: 'black-on-fluorescent-yellow',
    ink: '#000000',
    tape: '#e4f000',
    label: 'Black on fluorescent yellow',
    tze: 'TZe-C31',
  },
  {
    id: 'black-on-fluorescent-orange',
    ink: '#000000',
    tape: '#ff7a00',
    label: 'Black on fluorescent orange',
    tze: 'TZe-B31',
  },
];

/** The stock for an id, or null (the file's own colours) for anything else. */
export function resolveLbxTapeStock(id: unknown): LbxTapeStock | null {
  if (typeof id !== 'string' || id === LBX_FILE_STOCK_ID) return null;
  return LBX_TAPE_STOCKS.find((stock) => stock.id === id) ?? null;
}
