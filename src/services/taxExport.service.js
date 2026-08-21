const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const inr = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Streams a one-page tax estimate summary PDF directly to `res`. */
function streamEstimatePdf(estimate, res) {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text('GigLedger — Tax Estimate Summary', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#555').text(`Period: ${estimate.period}   |   Regime: ${estimate.regime}   |   Slab Year: ${estimate.slabYear}`);
  doc.moveDown(1);

  doc.fillColor('#000').fontSize(13).text('Summary');
  doc.moveDown(0.3);
  const summaryRows = [
    ['Gross Income', inr(estimate.grossIncome)],
    ['Total Deductions', inr(estimate.totalDeductions)],
    ['Taxable Income', inr(estimate.taxableIncome)],
    ['Estimated Tax Due', inr(estimate.estimatedTax)],
  ];
  summaryRows.forEach(([label, value]) => {
    doc.fontSize(11).text(`${label}: `, { continued: true }).font('Helvetica-Bold').text(value).font('Helvetica');
  });

  doc.moveDown(1);
  doc.fontSize(13).text('Slab Breakdown');
  doc.moveDown(0.3);
  (estimate.slabBreakdown || []).forEach((slab) => {
    doc.fontSize(10).text(
      `Up to Rs. ${Number(slab.threshold).toLocaleString('en-IN')} @ ${Math.round(slab.rate * 100)}% — tax ${inr(slab.taxForBand)}`,
    );
  });

  doc.moveDown(1);
  doc.fontSize(13).text('Cited Rules');
  doc.moveDown(0.3);
  (estimate.rulesUsed || []).forEach((rule) => {
    doc.fontSize(10).text(`- ${rule.title} (${rule.sourceUrl})`);
  });

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor('#888').text(
    'This is an estimate for planning purposes only, generated from retrieved public tax-rule text. It is not tax advice.',
  );

  doc.end();
}

/** Streams a one-sheet tax estimate workbook directly to `res`. */
async function streamEstimateExcel(estimate, res) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tax Estimate');

  sheet.columns = [{ width: 28 }, { width: 24 }];
  sheet.addRow(['GigLedger Tax Estimate', estimate.period]).font = { bold: true };
  sheet.addRow(['Regime', estimate.regime]);
  sheet.addRow(['Slab Year', estimate.slabYear]);
  sheet.addRow([]);

  sheet.addRow(['Gross Income', estimate.grossIncome]);
  sheet.addRow(['Total Deductions', estimate.totalDeductions]);
  sheet.addRow(['Taxable Income', estimate.taxableIncome]);
  sheet.addRow(['Estimated Tax Due', estimate.estimatedTax]);
  sheet.addRow([]);

  sheet.addRow(['Slab Breakdown']).font = { bold: true };
  sheet.addRow(['Threshold', 'Rate', 'Amount In Band', 'Tax For Band']);
  (estimate.slabBreakdown || []).forEach((slab) => {
    sheet.addRow([slab.threshold, slab.rate, slab.amountInBand, slab.taxForBand]);
  });
  sheet.addRow([]);

  sheet.addRow(['Cited Rules']).font = { bold: true };
  sheet.addRow(['Title', 'Source URL']);
  (estimate.rulesUsed || []).forEach((rule) => {
    sheet.addRow([rule.title, rule.sourceUrl]);
  });

  await workbook.xlsx.write(res);
}

module.exports = { streamEstimatePdf, streamEstimateExcel };
