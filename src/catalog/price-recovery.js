// Only public price-feed GETs. A timeout bounds both headers and body.
export async function fetchPriceCSV(url, cache = 'default', options = {}) {
  const { attempts = 3, timeoutMs = 6000, delayMs = 500, fetchImpl = fetch } = options;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { cache: attempt ? 'no-store' : cache, signal: controller.signal });
          if (!response.ok) throw new Error(`Price feed HTTP ${response.status}`);
          const csv = await response.text();
          const header = csv.split(/\r?\n/, 1)[0].toLowerCase();
          if (!csv.trim() || /^\s*</.test(csv) || !/(price|цена)/.test(header) || !/(title|наименование|товар)/.test(header)) throw new Error('Invalid price CSV schema');
          return csv;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Price feed timeout')); }, timeoutMs); })
      ]);
    } catch (error) { lastError = error; }
    finally { clearTimeout(timer); }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw lastError;
}

export function setPriceStatus(card, status) {
  card.dataset.priceStatus = status;
  const buy = card.querySelector('.buy-btn');
  if (buy) {
    buy.setAttribute('aria-disabled', status === 'ready' ? 'false' : 'true');
    if (status !== 'ready') delete buy.dataset.price;
  }
  if (status === 'error' || status === 'unavailable') {
    card.querySelectorAll('[data-price-decor], .price').forEach(el => {
      const target = el.querySelector('.text-block-wrap-div') || el;
      target.textContent = status === 'error' ? 'Цена временно недоступна. Обновите страницу' : 'Нет в наличии';
    });
  }
}

export function guardPricePurchase(event) {
  const button = event.target.closest('.buy-btn');
  const card = button?.closest('[data-price-status]');
  if (card && card.dataset.priceStatus !== 'ready') {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
