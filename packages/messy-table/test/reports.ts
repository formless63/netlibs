// Invented reports in the shapes real exports take: junk rows, long preambles,
// blank lines after the header.
const ORDERS_HEADER =
  'Order Number,Buyer Username,Buyer Name,Buyer Email,Ship To Name,Ship To Address 1,Ship To City,Ship To State,Ship To Zip,Ship To Country,Buyer Address 1,Buyer City,Buyer State,Buyer Zip,Buyer Country,Item Number,Item Title,Custom Label,Quantity,Sold For,Total Price,Variation Details,Marketplace Tax,Seller Collected Tax,Sale Date,Paid On Date,Shipped On Date,Transaction ID';
export const ORDERS_CSV = [
  ',,,,,,,,,,,,,,,,,,,,,,,,,,,', // line 1: junk comma row
  ORDERS_HEADER, // line 2: header
  '', // line 3: blank
  // line 4+: data (ORD-1 has two line items; shipped ⇒ FULFILLED)
  'ORD-1,buyer-1,Jane Doe,jane@example.com,Jane Doe,123 Main St,Austin,TX,78701,US,123 Main St,Austin,TX,78701,US,110011,Blue Widget,SKU-A,2,$12.00,$24.00,Color: Gray,$2.40,,2026-07-01T10:00:00Z,2026-07-01T10:05:00Z,2026-07-02T09:00:00Z,TXN-1',
  'ORD-1,buyer-1,Jane Doe,jane@example.com,Jane Doe,123 Main St,Austin,TX,78701,US,123 Main St,Austin,TX,78701,US,110022,Red Widget,,1,$9.00,$9.00,,$0.00,,2026-07-01T10:00:00Z,2026-07-01T10:05:00Z,2026-07-02T09:00:00Z,TXN-2',
  // ORD-2: no Shipped On Date ⇒ NOT_STARTED, Paid On Date present ⇒ PAID
  'ORD-2,buyer-2,John Roe,,John Roe,456 Oak Ave,Reno,NV,89501,US,456 Oak Ave,Reno,NV,89501,US,110012,Green Widget,SKU-C,1,$15.00,$15.00,,$1.20,,2026-07-03T09:00:00Z,2026-07-03T09:05:00Z,,TXN-3'
].join('\n');

// ---------------------------------------------------------------------------
// Transaction report — 11-line preamble, header row 12, blank row 13, data 14+
// ---------------------------------------------------------------------------
const TXN_HEADER =
  'Transaction creation date,Type,Order number,Net amount,Marketplace tax,Seller collected tax,Item subtotal,Item ID,Transaction ID,Payout currency,Reference ID,Description';
export const TRANSACTIONS_CSV = [
  '--,--,--,--,--', // 1
  'Notes', // 2
  'Gross transaction amount: total payment before fees.', // 3
  'Net amounts are listed in the payout currency.', // 4
  'All fee amounts shown include taxes.', // 5
  '', // 6
  'Transaction report', // 7
  'This report includes transaction type,"order, refund, payout"', // 8
  'Seller,example', // 9
  'Start date,Jan-01-2026', // 10
  'End date,Jul-23-2026', // 11
  TXN_HEADER, // 12: header
  '', // 13: blank
  // 14+: data
  '2026-07-05,Order,ORD-1,22.90,3.10,0.00,24.00,110011,TXN-1,USD,,',
  '2026-07-06,Refund,ORD-2,-5.00,-0.40,0.00,,110012,TXR-9,USD,R-500,Item not as described',
  '2026-07-07,Payout,,50.00,,,,,,USD,PO-1,Weekly payout'
].join('\n');

// ---------------------------------------------------------------------------
// Active Listings — clean header row 1
// ---------------------------------------------------------------------------
export const LISTINGS_CSV = [
  'Item number,Custom label (SKU),Title,Current price,Variation details,Available quantity,Format,Condition,Category name,Currency',
  '110011,SKU-A,Blue Widget,$12.00,Color: Gray,5,FixedPrice,New,Widgets,USD',
  '110012,SKU-C,Green Widget,$15.00,,3,FixedPrice,New,Widgets,USD'
].join('\n');

