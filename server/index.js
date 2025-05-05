require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
import { pipeline } from '@xenova/transformers';
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const Groq = require('groq-sdk');
const { exec } = require('child_process');

const app = express();

// Initialize directories
const uploadDir = path.join(__dirname, 'uploads');
const testDir = path.join(__dirname, 'generated-tests');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

// Groq API Configuration
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Remote Model Handler
class RemoteAnalyzer {
  static async analyze(text) {
    let completion;
    try {
      completion = await groq.chat.completions.create({
        messages: [{
          role: "user",
          content: `Generate Playwright test scripts from SRS text with these strict rules:
1. NEVER include percentages like (0%) or (100%) in test names
2. Test names should be descriptive but concise
3. Structure tests properly with describe() blocks
4. Include all necessary imports and assertions

Example of BAD naming (REJECT THIS FORMAT):
test('functional requirement (75%)', ...)

Example of GOOD naming (USE THIS FORMAT):
test('Validate login functionality', ...)

Generate only the test code with no percentages in names.`
        }],
        model: "llama3-70b-8192",
      });

      // Post-process the response to remove any percentages that might slip through
      let result = completion.choices[0]?.message?.content || "";
      result = result.replace(/\(\d+%\)/g, ''); // Remove all (XX%) patterns
      result = result.replace(/\s{2,}/g, ' ');  // Clean up extra spaces

      const labels = ["functional requirement", "non-functional requirement", "use case", "constraint"];
      const categories = labels.map(label => ({
        label,
        score: result.includes(label) ? 1 : 0
      }));

      return {
        categories,
        entities: extractEntities(text),
        method: 'remote',
        testScript: result
      };

    } catch (error) {
      console.error("Error calling Groq API:", error);
      throw new Error('Remote model failed');
    }
  }
}


// MongoDB Schema
const TestRunSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  documentName: String,
  summary: {
    passed: Number,
    failed: Number,
    total: Number,
    applicationAvailable: Boolean
  },
  details: [ {
    title: String,
    status: String,
    duration: Number,
    error: String
  } ]
});
const TestRun = mongoose.model('TestRun', TestRunSchema);

// Middleware
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// Improved MongoDB connection with retry
const connectWithRetry = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/qa-system', {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      retryWrites: true,
      retryReads: true
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    setTimeout(connectWithRetry, 5000);
  }
};
connectWithRetry();

// File Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowedTypes.includes(file.mimetype) && ['.pdf', '.docx'].includes(ext));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Text Processing
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.pdf') {
      const pdf = require('pdf-parse');
      const data = await pdf(fs.readFileSync(filePath));
      return data.text;
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    throw new Error('Unsupported file type');
  } catch (err) {
    throw new Error(`Text extraction failed: ${err.message}`);
  }
}

function extractEntities(text) {
  if (typeof text !== 'string') return [];
  const roles = (text.match(/\b(admin|user|manager)\b/gi) || []).map(w => ({ word: w, entity_group: 'ROLE' }));
  const systems = (text.match(/\b(database|API|server)\b/gi) || []).map(w => ({ word: w, entity_group: 'SYSTEM' }));
  return [...roles, ...systems];
}

// Enhanced Test Generation
function generateTestSteps(label, entities = []) {
  const roles = entities.filter(e => e.entity_group === 'ROLE');
  const systems = entities.filter(e => e.entity_group === 'SYSTEM');

  return `
    // 1. Check application availability
    let appAvailable = true;
    try {
      const response = await page.request.get('http://localhost:3000');
      appAvailable = response.status() === 200;
    } catch {
      appAvailable = false;
    }

    if (!appAvailable) {
      throw new Error('Frontend application not running at http://localhost:3000');
    }

    // 2. Proceed with tests
    ${roles.length > 0 ? `
    // Role test
    const role = '${roles[0]?.word.toLowerCase() || 'user'}';
    await page.goto('http://localhost:3000/login');
    await page.fill('#email', role + '@test.com');
    await page.fill('#password', role + '123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('http://localhost:3000/' + role + '-dashboard');
    ` : ''}

    ${systems.some(s => s.word === 'database') ? `
    // System check
    const dbResponse = await page.request.get('http://localhost:3000/api/health');
    await expect(dbResponse).toBeOK();
    await expect(await dbResponse.json()).toHaveProperty('status', 'healthy');
    ` : ''}
  `;
}

function generateTestScript(analysis) {
  let testCases = `
    const { test, expect } = require('@playwright/test');
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

    test.describe('Generated Tests from ${analysis.method}', () => {
  `;

  analysis.categories.forEach((category, index) => {
    const testName = `${category.label.replace(/\s+/g, '-').toLowerCase()}-${index}`;
   

    testCases += `
      test('${category.label} ', async ({ page }) => {
        // 1. Basic application availability check
        const response = await page.request.get(BASE_URL);
        await expect(response).toBeOK();

        // 2. Navigate to page
        await page.goto(BASE_URL);
        await expect(page).toHaveURL(BASE_URL);

        // 3. Basic content checks
        await expect(page.locator('body')).not.toBeEmpty();

        // 4. Category-specific checks
        ${getCategorySpecificChecks(category.label)}
      });
    `;
  });

  testCases += `
    });
  `;

  return {
    script: testCases,
    status: 'success'
  };
}

function getCategorySpecificChecks(category) {
  switch(category.toLowerCase()) {
    case 'functional requirement':
      return `
        // Functional requirement checks
        await expect(page).toHaveTitle(/./); // Title exists
        const buttons = await page.locator('button').count();
        await expect(buttons).toBeGreaterThan(0); // At least one button
      `;
    case 'non-functional requirement':
      return `
        // Performance check
        const startTime = Date.now();
        await page.reload();
        const loadTime = Date.now() - startTime;
        console.log('Page loaded in', loadTime, 'ms');
        await expect(loadTime).toBeLessThan(2000); // Under 2 seconds
      `;
    case 'use case':
      return `
        // Use case validation
        await expect(page.locator('a[href*="login"]')).toBeVisible();
      `;
    default:
      return `
        // Default validation
        await expect(page.locator('body')).toBeVisible();
      `;
  }
}

// Routes
app.post('/api/upload', upload.single('srsDocument'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const text = await extractText(req.file.path);
    const analysis = await RemoteAnalyzer.analyze(text);
    const { script: testScript, status } = await generateTestScript(analysis);

    res.json({
      message: status === 'success' ? 'Analysis complete!' : 'Analysis completed with warnings',
      requirements: {
        features: {
          labels: analysis.categories.map(c => c.label),
          scores: analysis.categories.map(c => c.score)
        },
        entities: analysis.entities
      },
      testScript,
      analysisStatus: status
    });

  } catch (err) {
    console.error('Upload error:', err.message);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ 
      error: err.message.includes('Invalid file') ? err.message : 'Processing failed',
      details: err.message
    });
  }
});

app.get('/api/test-history', async (req, res) => {
  try {
    const dbReady = mongoose.connection.readyState === 1;
    if (!dbReady) {
      return res.status(503).json({
        error: 'Database not ready',
        details: 'Please wait for database connection',
        databaseStatus: mongoose.STATES[mongoose.connection.readyState]
      });
    }

    const history = await TestRun.find()
      .sort({ timestamp: -1 })
      .limit(10)
      .maxTimeMS(5000)
      .lean();

    res.json(history || []);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({
      error: 'Failed to fetch history',
      details: err.message,
      databaseStatus: mongoose.STATES[mongoose.connection.readyState]
    });
  }
});
app.post('/api/run-tests', async (req, res) => {
  try {
    const { testScript, documentName } = req.body;
    if (!testScript) return res.status(400).json({ error: 'No test script provided' });

    // Define the path for the test script file
    const testScriptFilePath = path.join(testDir, `${documentName}_test.spec.js`);

    // Save the test script to the file
    fs.writeFileSync(testScriptFilePath, testScript);

    // Run the test script using Playwright
    const result = await new Promise((resolve, reject) => {
      exec(`npx playwright test ${testScriptFilePath}`, (error, stdout, stderr) => {
        if (error) {
          reject({ error, stderr });
        } else {
          resolve(stdout);
        }
      });
    });

    // Clean up the temporary file
    fs.unlinkSync(testScriptFilePath);

    // Send the result back to the frontend
    res.json({ result });
  } catch (err) {
    console.error('Run tests error:', err.message);
    res.status(500).json({ error: 'Failed to run tests', details: err.message });
  }
});

app.get('/api/server-status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date(),
    database: mongoose.STATES[mongoose.connection.readyState],
    services: {
      playwright: true
    }
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Playwright test generation enabled');
});
