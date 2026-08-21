const PDFDocument = require('pdfkit');

/**
 * Renders a one-page tax computation sheet as a PDFKit document, returned
 * already streaming — callers pipe it straight into an HTTP response, no
 * buffering the full file in memory first.
 * @param {object} reportData - shape from report.service.js#buildReportData
 * @returns {import('pdfkit')} a PDFDocument (itself a readable stream)
 */
function renderPdf(reportData) {
  const doc = new PDFDocument({ margin: 50 });

  doc.fontSize(18).text('GigLedger — Tax Computation Sheet', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('#555').text(
    `Period: ${reportData.period}  |  Regime: ${reportData.regime}  |  Slab year: ${reportData.slabYear}  |  Generated: ${reportData.generatedAt.toISOString()}`,
  );
  doc.fillColor('#000').moveDown(1.5);

  doc.fontSize(14).text('Summary');
  doc.fontSize(11).moveDown(0.5);
  doc.text(`Gross Income: Rs. ${reportData.grossIncome.toLocaleString('en-IN')}`);
  doc.text(`Total Deductions: Rs. ${reportData.totalDeductions.toLocaleString('en-IN')}`);
  doc.text(`Taxable Income: Rs. ${reportData.taxableIncome.toLocaleString('en-IN')}`);
  doc.font('Helvetica-Bold').text(`Estimated Tax: Rs. ${reportData.estimatedTax.toLocaleString('en-IN')}`);
  doc.font('Helvetica').moveDown(1.5);

  doc.fontSize(14).text('Slab Breakdown');
  doc.fontSize(11).moveDown(0.5);
  reportData.slabBreakdown.forEach((slab) => {
    doc.text(
      `Up to Rs. ${slab.threshold.toLocaleString('en-IN')} @ ${(slab.rate * 100).toFixed(0)}% -> Rs. ${slab.amountInBand.toLocaleString('en-IN')} taxed at Rs. ${slab.taxForBand.toLocaleString('en-IN')}`,
    );
  });
  doc.moveDown(1.5);

  doc.fontSize(14).text('Cited Tax Rules');
  doc.fontSize(11).moveDown(0.5);
  if (reportData.rulesUsed.length === 0) {
    doc.text('No specific rule citations were available for this estimate.');
  } else {
    reportData.rulesUsed.forEach((rule) => {
      doc.text(`${rule.title} — ${rule.sourceUrl}`);
    });
  }
  doc.moveDown(1.5);

  doc.fontSize(9).fillColor('#888').text(
    'This is an estimate only, generated for informational purposes, and is not a substitute for professional tax advice.',
    { align: 'center' },
  );

  doc.end();
  return doc;
}

module.exports = { renderPdf };
