const ExcelJS = require('exceljs');

/**
 * Renders the same tax computation sheet as the PDF version, in one flat
 * worksheet. Returns a Buffer — exceljs' streaming writer needs a real
 * writable target (file/socket), so for an HTTP response we build the
 * workbook in memory and hand back the finished bytes; report sizes here
 * are always tiny (a handful of slab rows and rule citations), so this
 * never becomes a memory concern.
 * @param {object} reportData - shape from report.service.js#buildReportData
 * @returns {Promise<Buffer>}
 */
async function renderExcel(reportData) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tax Computation');

  sheet.columns = [{ width: 30 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 40 }];

  sheet.addRow(['GigLedger — Tax Computation Sheet']).font = { bold: true, size: 14 };
  sheet.addRow([
    `Period: ${reportData.period}`,
    `Regime: ${reportData.regime}`,
    `Slab year: ${reportData.slabYear}`,
    `Generated: ${reportData.generatedAt.toISOString()}`,
  ]);
  sheet.addRow([]);

  sheet.addRow(['Summary']).font = { bold: true };
  sheet.addRow(['Gross Income', reportData.grossIncome]);
  sheet.addRow(['Total Deductions', reportData.totalDeductions]);
  sheet.addRow(['Taxable Income', reportData.taxableIncome]);
  sheet.addRow(['Estimated Tax', reportData.estimatedTax]).font = { bold: true };
  sheet.addRow([]);

  sheet.addRow(['Slab Breakdown']).font = { bold: true };
  sheet.addRow(['Threshold', 'Rate', 'Amount In Band', 'Tax For Band']).font = { bold: true };
  reportData.slabBreakdown.forEach((slab) => {
    sheet.addRow([slab.threshold, slab.rate, slab.amountInBand, slab.taxForBand]);
  });
  sheet.addRow([]);

  sheet.addRow(['Cited Tax Rules']).font = { bold: true };
  sheet.addRow(['Rule ID', 'Title', 'Source URL']).font = { bold: true };
  reportData.rulesUsed.forEach((rule) => {
    sheet.addRow([rule.ruleId, rule.title, rule.sourceUrl]);
  });
  sheet.addRow([]);

  sheet.addRow(['Estimate only — not a substitute for professional tax advice.']);

  return workbook.xlsx.writeBuffer();
}

module.exports = { renderExcel };
