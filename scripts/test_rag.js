import dotenv from 'dotenv';
import { initializeDatabase, searchTaxRules, calculateTaxWithRAG } from '../services/ragService.js';

dotenv.config();

async function runRAGTest() {
  console.log('====================================================');
  console.log('🧪 Testing RAG Engine & Vector Search (Without Routes)');
  console.log('====================================================\n');

  // 1. Initialize Database connection & local fallback
  await initializeDatabase();

  // 2. Test Direct Semantic Vector Search
  const searchQuery = 'I have bought software to host my website';
  console.log(`\n🔍 Test 1: Vector Search Query -> "${searchQuery}"`);
  console.log('----------------------------------------------------');
  
  try {
    const topRules = await searchTaxRules(searchQuery, 3);
    console.log(`✅ Retrieved Top ${topRules.length} Relevant Tax Rules:`);
    topRules.forEach((rule, idx) => {
      console.log(`\n  [Rule ${idx + 1}] ID: ${rule.id}`);
      console.log(`  📌 Title: ${rule.title}`);
      console.log(`  🔗 Source: ${rule.source_url}`);
      console.log(`  📝 Content Snippet: ${rule.content.substring(0, 120)}...`);
      if (rule.similarityScore !== undefined) {
        console.log(`  📊 Similarity Score: ${rule.similarityScore.toFixed(4)}`);
      }
    });
  } catch (err) {
    console.error('❌ Vector Search Error:', err.message);
  }

  // 3. Test Full Grounded RAG Tax Calculation
  console.log('\n\n🧮 Test 2: Full RAG Tax Calculation & Grounded AI Report');
  console.log('----------------------------------------------------');

  const mockEarnings = { totalGross: 750000 };
  const mockExpenses = [
    { description: 'HPCL Petrol Pump Fuel Receipts for Uber Rides', amount: 45000 },
    { description: 'Mobile Recharge & High-Speed Internet Bill for Ride Booking App', amount: 15000 },
    { description: 'Annual Car Servicing and Engine Oil Change', amount: 12000 }
  ];

  console.log('👤 Mock User Profile:');
  console.log(`   - Total Gross Earnings: ₹${mockEarnings.totalGross}`);
  console.log('   - Expense Transactions:', JSON.stringify(mockExpenses, null, 2));

  console.log('\n⏳ Running RAG Service (Retrieving Rules + Calling Gemini)...');

  try {
    const ragResult = await calculateTaxWithRAG(mockEarnings, mockExpenses);

    console.log('\n🎉 RAG Tax Calculation Complete!');
    console.log('\n====================================================');
    console.log('📊 GENERATED GROUNDED TAX REPORT:');
    console.log('====================================================');
    console.log(JSON.stringify(ragResult.taxReport, null, 2));

    console.log('\n====================================================');
    console.log('📚 RETRIEVED TAX RULES USED AS CONTEXT:');
    console.log('====================================================');
    ragResult.retrievedRules.forEach((r, idx) => {
      console.log(`[${idx + 1}] ${r.id} - ${r.title} (${r.source_url})`);
    });

  } catch (err) {
    console.error('❌ RAG Tax Calculation Error:', err.message);
  }

  process.exit(0);
}

runRAGTest();
