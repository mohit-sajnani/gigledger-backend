/**
 * Fixed Indian statutory tax calendar (Apr-Mar fiscal year). `month` is
 * 0-indexed (JS Date convention). `yearOffset` says which calendar year a
 * rule's date falls in relative to the FY's start year — most advance-tax
 * quarters land in the FY start year itself, but Q4 (March) and ITR filing
 * (July) both land in the year after, which the month number alone can't
 * tell you (July isn't a small month index, so a "month < 3" heuristic
 * would silently put ITR filing a full year too early).
 */
module.exports = [
  { label: 'Q1 Advance Tax', type: 'advance_tax', month: 5, day: 15, quarter: 'Q1', yearOffset: 0 }, // Jun 15
  { label: 'Q2 Advance Tax', type: 'advance_tax', month: 8, day: 15, quarter: 'Q2', yearOffset: 0 }, // Sep 15
  { label: 'Q3 Advance Tax', type: 'advance_tax', month: 11, day: 15, quarter: 'Q3', yearOffset: 0 }, // Dec 15
  { label: 'Q4 Advance Tax', type: 'advance_tax', month: 2, day: 15, quarter: 'Q4', yearOffset: 1 }, // Mar 15, next calendar year
  { label: 'ITR Filing', type: 'filing', month: 6, day: 31, quarter: null, yearOffset: 1 }, // Jul 31, next calendar year
];
