# @formless63/messy-table

Read tables out of the spreadsheets and reports people actually send: a title and
notes above the header, columns renamed or reordered, totals below, `$1,234.50`
in one cell and `n/a` in the next.

It takes rows of cells, so use any CSV or spreadsheet parser.

```ts
import Papa from 'papaparse';
import { column, date, decimal, integer, readTable } from '@formless63/messy-table';

const table = readTable(Papa.parse<string[]>(text).data, {
  order: column('Order Number', { required: true }),
  quantity: column(['Qty', 'Quantity'], { read: integer }),
  total: column(/^total/, { read: decimal() }),
  sold: column('Sale Date', { read: date({ order: 'mdy' }) }),
});

if (!table) throw new Error('That does not look like an orders report.');
table.rows[0].values; // { order: string | null, quantity: number | null, total: string | null, … }
table.problems; // [{ rowNumber: 10, column: 'total', message: '"TBD later" is not a number' }]
table.missing; // declared columns it does not have
table.unknown; // headers nothing matched
table.preamble; // rows above the header, for dates and metadata
```

With SheetJS: `XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })`.

## Finding the table

The header row is the one naming most of your columns, among those naming every
`required` one, in the first 50 rows. Headers match text (case and spacing
ignored) or patterns. Declare specific patterns before general ones: `previous
price` before `price`.

`detectLayout(grid, { orders, refunds })` says which report a file is.

| Option                                |                                                                    |
| ------------------------------------- | ------------------------------------------------------------------ |
| `stopAt`                              | End at a footer or totals row                                      |
| `skip`                                | Ignore a row. Blank rows always are                                |
| `sections`                            | A row with one filled cell becomes the `section` of the rows below |
| `headerRow`, `scanRows`, `minColumns` | Control the search                                                 |

## Reading cells

Readers return a value, null for nothing (`''`, `-`, `n/a`, `TBD`), or a problem.
They never guess: `Item 5` is not 5, and `1,5` is not 15.

| Reader              | Value                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `text`              | Trimmed text                                                                                                    |
| `decimal(options?)` | Exact decimal as a string, never through a float. Currency, grouping, `(5.00)`, `5.00-`; `,` decimals by option |
| `integer`, `number` | JavaScript numbers                                                                                              |
| `date(options?)`    | `YYYY-MM-DD` with no time zone. ISO, `5 Mar 2026`, Excel serials; `3/4/2026` only once `order` is given         |

A reader is `(cell) => ({ value, problem? })`, so write your own the same way.

Not for streaming: the whole grid is in memory. Merged cells and multi-row headers
are not understood.
