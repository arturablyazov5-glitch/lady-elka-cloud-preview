// Local mocked checkout proof for the lazy chunk, including shared cart state.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || import.meta.url)('playwright');
const base = process.env.LOCAL_BASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base || '')) throw Error('Local preview URL required');
const assets = await (await fetch(base + '/request-assets.json')).json();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const page = await context.newPage(), requests = [], errors = [];
    page.on('request', r => requests.push(r.url())); page.on('pageerror', e => errors.push(e.message));
    await page.route('**' + assets.demand, async route => { await new Promise(r=>setTimeout(r,250)); await route.continue(); });
    await page.goto(base + '/tree/miranda', {waitUntil:'networkidle'});
    assert.ok(!requests.some(url=>url.endsWith(assets.demand)), 'Forms chunk must be absent before interaction');
    const names = await page.locator('form[data-lead-type] [data-lead-field="phone"]').evaluateAll(nodes=>nodes.map(n=>({labels:n.labels.length,autocomplete:n.autocomplete})));
    assert.ok(names.every(n=>n.labels>0 && n.autocomplete==='tel'));
    // Submit immediately, before the intentionally delayed demand script can arrive.
    await page.evaluate(()=>document.querySelector('form[data-lead-type]').requestSubmit());
    await page.waitForFunction(()=>document.querySelector('[data-form-submit-notice]')?.textContent.includes('Проверьте'));
    await page.locator('[data-storefront-product] .buy-btn').first().click();
    await page.locator('[data-cart-up]').click();
    const before = await page.evaluate(()=>JSON.parse(localStorage.getItem('lady_elka_cart_v2')));
    assert.equal(before[0].quantity,2);
    await page.evaluate(()=>{
      const original=window.fetch;
      window.__LE_STOREFRONT_CONFIG__.payment='/__mock-order';
      window.fetch=async(input,init)=>{
        if(String(input).startsWith('/__mock-order')){
          window.__mockPayload=JSON.parse(init.body);
          return new Response(JSON.stringify({ok:true,orderId:'LOCAL-MOCK-ONLY'}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        return original(input,init);
      };
    });
    for(const [key,value] of Object.entries({name:'Локальная проверка',email:'qa@example.org',phone:'+7 (999) 123-45-67',address:'Москва, проверка'})) await page.locator(`[data-checkout-field="${key}"]`).fill(value);
    await page.locator('[data-checkout-field="paymentMethod"]').selectOption('cash_on_delivery');
    await page.locator('[data-checkout-field="contactPref"]').selectOption({index:1});
    await page.locator('[data-checkout-field="consent"]').evaluate(node=>{node.checked=true;node.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.evaluate(()=>{window.__events=[];for(const type of ['click','submit'])document.addEventListener(type,e=>window.__events.push([type,e.target.tagName,e.target.outerHTML?.slice(0,400),e.defaultPrevented]),true);});
    await page.locator('[data-pay-now]').click();
    await page.waitForFunction(()=>document.querySelector('[data-checkout-notice]')?.textContent.includes('оформлен'),null,{timeout:5000}).catch(async error=>{console.log(await page.evaluate(()=>({events:window.__events,button:document.querySelector('[data-pay-now]').outerHTML,buttonForm:document.querySelector('[data-pay-now]').form?.id,cartForm:document.querySelector('[data-cart-popup] form').id,errors:[],forms:[...document.forms].map(f=>({id:f.id,noValidate:f.noValidate,valid:f.checkValidity(),invalid:[...f.elements].filter(n=>n.willValidate&&!n.checkValidity()).map(n=>[n.name,n.validationMessage])})),notices:[...document.querySelectorAll('[role=status]')].map(n=>n.textContent),payload:window.__mockPayload,fields:[...document.querySelectorAll('[data-checkout-field]')].map(n=>[n.dataset.checkoutField,n.value,n.checked,n.getAttribute('aria-invalid')])})));throw error;});
    const state=await page.evaluate(()=>({payload:window.__mockPayload,cart:JSON.parse(localStorage.getItem('lady_elka_cart_v2')),empty:!!document.querySelector('[data-cart-empty]'),notice:document.querySelector('[data-checkout-notice]').textContent}));
    assert.equal(state.payload.items[0].quantity,2); assert.deepEqual(state.cart,[]); assert.ok(state.empty,'Owning cart subscribers must render successful clear');
    assert.equal(requests.filter(url=>url.endsWith(assets.demand)).length,1);
    assert.ok(!requests.some(url=>url.includes('__mock-order')), 'Mock order never reaches network');
    assert.deepEqual(errors,[]);
    results.push({width,initialChunkAbsent:true,immediateLeadValidation:true,quantityInPayload:2,cartCleared:true,chunkLoads:1,errors});
    await context.close();
  }
  await writeFile('integration-qa/request-budget/interactions.json',JSON.stringify({mocked:true,realOrders:0,results},null,2));
  console.log(JSON.stringify(results));
} finally {await browser.close();}
