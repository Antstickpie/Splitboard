/* eslint-disable */
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

// Persistent Chrome session directory in project root
const sessionDir = path.join(__dirname, '..', '.everydollar-chrome-session');
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

let browser = null;
let activePage = null;
let authPromise = null;
let idleTimer = null;
let inFlightCount = 0;

function isBrowserAlive(b) {
  if (!b) return false;
  try {
    if (typeof b.connected === 'boolean') return b.connected;
    if (typeof b.isConnected === 'function') return b.isConnected();
    return true;
  } catch (_) {
    return false;
  }
}

function isPageAlive(p) {
  if (!p) return false;
  try {
    return !p.isClosed();
  } catch (_) {
    return false;
  }
}

async function closeBrowserInstance() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (browser) {
    console.log('\nClosing Chrome browser session...');
    const b = browser;
    browser = null;
    activePage = null;
    authPromise = null;
    try {
      await b.close();
      console.log('Chrome closed.');
    } catch (err) {
      console.warn('Notice while closing browser:', err.message);
    }
  }
}

function resetIdleTimer(seconds = 30) {
  if (idleTimer) clearTimeout(idleTimer);
  if (inFlightCount > 0) return; // Do not auto-close while requests are being processed

  idleTimer = setTimeout(async () => {
    if (inFlightCount > 0) return;
    console.log(`\nInactivity timeout (${seconds}s). Closing Chrome...`);
    await closeBrowserInstance();
  }, seconds * 1000);
}

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Private-Network', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(
  cors({
    origin: '*',
  })
);

app.get('/', (_req, res) => {
  res.type('text/plain').send('EveryDollar proxy is running. Use /everydollar?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD');
});

app.all('/close-browser', async (_req, res) => {
  await closeBrowserInstance();
  res.json({ ok: true, message: 'Browser session closed.' });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'running',
    browserConnected: isBrowserAlive(browser),
    hasActivePage: isPageAlive(activePage),
  });
});

async function getBrowser() {
  if (isBrowserAlive(browser)) {
    return browser;
  }

  const launchOptions = {
    headless: false, // Visible mode so the user can easily log in
    userDataDir: sessionDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-site-isolation-trials',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  };

  console.log('Using persistent Chrome profile directory:', sessionDir);

  try {
    browser = await puppeteer.launch(launchOptions);
    return browser;
  } catch (error) {
    console.error('Error launching browser:', error.message);
    throw error;
  }
}

async function ensureAuthenticatedPage() {
  if (authPromise) {
    return authPromise;
  }

  authPromise = (async () => {
    const browserInstance = await getBrowser();

    if (!isPageAlive(activePage)) {
      const pages = await browserInstance.pages();
      activePage = pages.length > 0 ? pages[0] : await browserInstance.newPage();
      await activePage.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
    }

    let currentUrl = '';
    try {
      currentUrl = activePage.url();
    } catch (_) {
      currentUrl = '';
    }

    if (currentUrl.includes('everydollar.com/app')) {
      return activePage;
    }

    console.log('\nNavigating to EveryDollar...');
    try {
      await activePage.goto('https://www.everydollar.com/app/budget', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (e) {
      console.warn('Navigation note:', e.message);
    }

    currentUrl = activePage.url();
    // Check if redirected to login page
    if (!currentUrl.includes('everydollar.com/app')) {
      console.log('\n=============================================================');
      console.log('🔑 LOGIN REQUIRED');
      console.log('Please log into EveryDollar in the opened Chrome window.');
      console.log('Waiting up to 5 minutes for login to complete...');
      console.log('=============================================================\n');

      const maxWaitSeconds = 300; // 5 minutes
      const startTime = Date.now();

      while (true) {
        if (activePage.isClosed()) {
          throw new Error('Chrome window was closed before login could complete.');
        }

        const url = activePage.url();
        if (url.includes('everydollar.com/app')) {
          console.log('\n✅ Login successful! Session established.');
          // Allow session and cookies to settle
          await new Promise((r) => setTimeout(r, 3000));
          break;
        }

        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const remainingSec = maxWaitSeconds - elapsedSec;

        if (remainingSec <= 0) {
          throw new Error('Login timed out after 5 minutes. Please try again.');
        }

        if (elapsedSec % 5 === 0) {
          process.stdout.write(`\rWaiting for login... (${remainingSec}s remaining)   `);
        }

        await new Promise((r) => setTimeout(r, 1000));
      }
      process.stdout.write('\n');
    } else {
      console.log('✅ Active EveryDollar session found.');
    }

    return activePage;
  })();

  try {
    return await authPromise;
  } finally {
    authPromise = null;
  }
}

async function executeFetchOnPage(page, apiUrl) {
  return await page.evaluate(async (url) => {
    try {
      const response = await fetch(url, {
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
  }, apiUrl);
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
  )}&endDate=${encodeURIComponent(end)}&size=1000`;

  inFlightCount++;
  if (idleTimer) clearTimeout(idleTimer);

  try {
    console.log(`\n[Proxy Request] Fetching transactions from ${start} to ${end}...`);
    let page = await ensureAuthenticatedPage();

    // Execute fetch directly within the authenticated EveryDollar page context (with recovery retry)
    let apiResult;
    try {
      apiResult = await executeFetchOnPage(page, url);
    } catch (evalErr) {
      console.warn('Page context error, re-establishing page session:', evalErr.message);
      activePage = null;
      page = await ensureAuthenticatedPage();
      apiResult = await executeFetchOnPage(page, url);
    }

    // If 401 Unauthorized, try refreshing page to regain session once
    if (apiResult && apiResult.status === 401) {
      console.warn('Received 401 Unauthorized. Reloading EveryDollar page to re-establish session...');
      try {
        await page.goto('https://www.everydollar.com/app/budget', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        page = await ensureAuthenticatedPage();
        apiResult = await executeFetchOnPage(page, url);
      } catch (retryErr) {
        console.error('Session refresh failed:', retryErr.message);
      }
    }

    const { status, text } = apiResult || { status: 500, text: 'No result from page' };
    console.log(`[Proxy Response] Status: ${status}`);

    if (status >= 400) {
      console.error(`=== ERROR RESPONSE ${status} ===\n${text}\n=====================`);
    }


    res.status(status || 500);
    try {
      const json = JSON.parse(text);
      res.json(json);
    } catch {
      res.type('text/plain').send(text);
    }
  } catch (e) {
    console.error('Proxy error:', e.message || e);
    activePage = null;
    res.status(500).json({ error: 'Proxy error', message: String(e.message || e) });
  } finally {
    inFlightCount = Math.max(0, inFlightCount - 1);
    resetIdleTimer(30);
  }
});

// Handle uncaught errors gracefully so server doesn't crash
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message || error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`EveryDollar proxy running on http://localhost:${PORT} (and http://127.0.0.1:${PORT})`);
  console.log('Ready to fetch EveryDollar transactions via Puppeteer session.');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please terminate existing process or use PORT=4001.`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down proxy gracefully...');
  server.close(async () => {
    console.log('HTTP server closed');
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);


