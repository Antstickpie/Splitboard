/* eslint-disable */
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

let browser = null;

app.use(
  cors({
    origin: '*',
  })
);

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Private-Network', 'true');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('EveryDollar proxy is running. Use /everydollar?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'running' });
});


async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  // Create a temporary directory for Puppeteer's isolated session
  // This ensures your Chrome profile is not altered
  const tmpDir = path.join(os.tmpdir(), 'everydollar-proxy-chrome');
  
  // Create the temp directory if it doesn't exist
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

    const launchOptions = {
    headless: false, // Run in visible mode so we can see what's happening
    userDataDir: tmpDir, // Use isolated temporary profile directory
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security', // Disable CORS
      '--disable-features=VizDisplayCompositor',
      '--disable-site-isolation-trials', // Allow cross-origin requests
      '--disable-features=IsolateOrigins,site-per-process', // Additional CORS bypass
    ],
  };

  console.log('Using isolated temporary Chrome profile (your Chrome profile will not be altered)');
  console.log('Temporary profile location:', tmpDir);

  try {
    browser = await puppeteer.launch(launchOptions);
    return browser;
  } catch (error) {
    console.error('Error launching browser:', error.message);
    throw error;
  }
}

app.get('/everydollar', async (req, res) => {
  const start = req.query.startDate;
  const end = req.query.endDate;
  if (!start || !end) {
    res.status(400).json({ error: 'Missing startDate or endDate' });
    return;
  }

  const url = `https://www.everydollar.com/app/api/transactions/search/findByDateRange?startDate=${encodeURIComponent(
    start
  )}&endDate=${encodeURIComponent(end)}`;

  let page = null;
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // First, visit the login page and wait for user to log in
    console.log('Opening login page. Please log in to EveryDollar...');
    console.log('Waiting 3 seconds for you to complete login...');
    try {
      await page.goto('https://id.ramseysolutions.com/u/login', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      
      // Wait 3 seconds for user to log in with countdown
      const loginTimeout = 3; // seconds
      for (let remaining = loginTimeout; remaining > 0; remaining--) {
        process.stdout.write(`\rLogin countdown: ${remaining} seconds remaining... `);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      process.stdout.write('\n');
      
      // Check if we're now on EveryDollar (logged in)
      const currentUrl = page.url();
      console.log('Current URL after login wait:', currentUrl);
      
      // Check cookies
      const cookies = await page.cookies();
      console.log(`Found ${cookies.length} cookies after login`);
      if (cookies.length > 0) {
        const cookieNames = cookies.map(c => c.name).slice(0, 5).join(', ');
        console.log('Cookie names:', cookieNames, cookies.length > 5 ? '...' : '');
      }
      
      // Navigate to EveryDollar main page to ensure session is established
      console.log('Navigating to EveryDollar to establish session...');
      await page.goto('https://www.everydollar.com/app/budget', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      
      console.log('Waiting 2 seconds to ensure session is ready...');
      for (let remaining = 2; remaining > 0; remaining--) {
        process.stdout.write(`\rSession ready countdown: ${remaining} seconds... `);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      process.stdout.write('\n');
    } catch (e) {
      console.warn('Could not visit login page:', e.message);
    }
    
    // Ensure we're on everydollar.com page before making the fetch
    const currentUrl = page.url();
    console.log('Current page URL before fetch:', currentUrl);
        
    // Wait a bit for any async authentication to complete
    console.log('Waiting for authentication to settle...');
    await new Promise(resolve => setTimeout(resolve, 3000));
        
    // Get all cookies and log them for debugging
    const allCookies = await page.cookies();
    console.log(`\nTotal cookies available: ${allCookies.length}`);
    const relevantCookies = allCookies.filter(c => 
      c.domain.includes('everydollar.com') || 
      c.domain.includes('ramseysolutions.com')
    );
    console.log(`Cookies for EveryDollar/Ramsey domains: ${relevantCookies.length}`);
    if (relevantCookies.length > 0) {
      console.log('Relevant cookie names:', relevantCookies.map(c => c.name).join(', '));
      
      // Check for SESSION cookie specifically
      const sessionCookie = relevantCookies.find(c => c.name === 'SESSION' || c.name.toLowerCase().includes('session'));
      if (sessionCookie) {
        console.log(`SESSION cookie found: ${sessionCookie.name} (domain: ${sessionCookie.domain}, value length: ${sessionCookie.value.length})`);
      } else {
        console.warn('WARNING: No SESSION cookie found! This might be why authentication is failing.');
      }
    }
    
    // Set up response interception to capture the API response
    let capturedResponse = null;
    let responseText = null;
    
    page.on('response', async (response) => {
      const responseUrl = response.url();
      if (responseUrl.includes('/api/transactions/search/findByDateRange')) {
        capturedResponse = response;
        responseText = await response.text();
        console.log(`Captured API response with status: ${response.status()}`);
        console.log(responseText);
      }
    });
    
    // Use fetch from the page context - this will use all cookies automatically
    console.log('Making fetch request from page context...');
    const apiResult = await page.evaluate(async (apiUrl) => {
      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.everydollar.com/',
            'Origin': 'https://www.everydollar.com',
          },
        });
        const text = await response.text();
        return {
          status: response.status,
          ok: response.ok,
          text: text,
        };
      } catch (error) {
        return {
          status: 0,
          ok: false,
          text: `Fetch error: ${error.message}`,
        };
      }
    }, url);
    
    // Wait a moment for response interception
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Use intercepted response if available, otherwise use fetch result
    const status = capturedResponse ? capturedResponse.status() : apiResult.status;
    const text = responseText || apiResult.text;
    
    console.log('Response status:', status);
    if (status >= 400) {
      console.error('\n=== ERROR RESPONSE ===');
      console.error('Status:', status);
      console.error('Response text:', text);
      console.error('=====================\n');
      if (status === 401) {
        console.error('401 Unauthorized - Session may have expired or cookies not loaded properly');
        console.error('The API rejected the request. Possible reasons:');
        console.error('  1. Session cookie is invalid or expired');
        console.error('  2. Missing required authentication cookies');
        console.error('  3. API requires additional headers or tokens');
        console.error('\nTry: 1) Make sure you are fully logged into EveryDollar');
        console.error('     2) Check that you can access the API manually in the browser');
        console.error('     3) Restart the proxy server and try again');
      }
    } else if (status >= 200 && status < 300 && text) {
      // Save the response to selected-transactions.json if the request was successful
      try {
        const jsonPath = path.join(__dirname, '..', 'src', 'data', 'selected-transactions.json');
        const jsonData = JSON.parse(text);
        
        // Write the parsed JSON with proper formatting
        fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
        console.log(`\n✓ Successfully saved response to ${jsonPath}`);
      } catch (saveError) {
        console.error('\n⚠ Failed to save response to selected-transactions.json:', saveError.message);
        // Don't fail the request if saving fails
      }
    }
    
    process.stdout.write('\n');

    res.status(status);
    try {
      const json = JSON.parse(text);
      res.json(json);
    } catch {
      res.type('text/plain').send(text);
    }
  } catch (e) {
    console.error('Proxy error:', e);
    res.status(500).json({ error: 'Proxy error', message: String(e) });
  } finally {
    if (page) {
      await page.close();
    }
  }
});

// Handle uncaught errors to prevent server from crashing
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - keep server running
});

const server = app.listen(PORT, () => {
  console.log(`EveryDollar proxy running on http://localhost:${PORT}`);
  console.log('Using Puppeteer to access Chrome with your session');
});

// Keep the process alive
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please use a different port.`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    if (browser) {
      browser.close().then(() => process.exit(0)).catch(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    if (browser) {
      browser.close().then(() => process.exit(0)).catch(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
});


