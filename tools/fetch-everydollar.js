/* eslint-disable */
const { getCookiesPromised } = require('chrome-cookies-secure');
const fetch = require('node-fetch');
const minimist = require('minimist');

async function main() {
  const argv = minimist(process.argv.slice(2));
  const start = argv.start || argv.s;
  const end = argv.end || argv.e;
  if (!start || !end) {
    console.error('Usage: npm run fetch:everydollar -- --start=YYYY-MM-DD --end=YYYY-MM-DD');
    process.exit(1);
  }

  const url = `https://www.everydollar.com/app/api/transactions/search/findByDateRange?startDate=${encodeURIComponent(
    start
  )}&endDate=${encodeURIComponent(end)}`;

  try {
    const cookieHeader = await getCookieHeader('https://www.everydollar.com');
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Node) EveryDollarFetcher/1.0',
      },
    });

    console.log('Status:', res.status, res.statusText);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(text);
    }
  } catch (err) {
    console.error('Failed to fetch with Chrome cookies:', err);
    process.exit(2);
  }
}

async function getCookieHeader(targetUrl) {
  // Reads cookies from the default Chrome profile on this OS
  const cookies = await getCookiesPromised(targetUrl, {
    // leave options default; it will auto-detect the Chrome cookie store on Linux
    // You can specify a custom profile with { profile: 'Default' }
  });
  return Object.entries(cookies)
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join('; ');
}

main();


