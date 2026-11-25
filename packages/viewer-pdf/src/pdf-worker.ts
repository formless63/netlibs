// Worker entry. A local file so bundlers resolve `new URL('./pdf-worker.js',
// import.meta.url)` without depending on bare-specifier URL support.
import 'pdfjs-dist/build/pdf.worker.min.mjs';
