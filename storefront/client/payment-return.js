import { paymentEndpoint } from './config.js';
import { postJson } from './request-errors.js';
const pendingKey = 'lady_elka_pending_order_v1';
const draftKey = 'lady_elka_checkout_draft_v1';
const receiptKey = 'lady_elka_paid_return_v2';
const itemProjection = items => items.map(item => ({productId:item.productId,variantId:item.variantId,kind:item.kind,quantity:item.quantity,price:item.price}))
  .sort((a,b)=>(a.productId+'|'+a.variantId).localeCompare(b.productId+'|'+b.variantId));
export function samePurchasedCart(items, payload) {
  return JSON.stringify(itemProjection(items)) === JSON.stringify(itemProjection(payload.items || []));
}
export function initPaymentReturn(cart, {document:doc=document, location:loc=location, storage, request=postJson} = {}) {
  if (!['/spasibo','/pay-return'].includes(loc.pathname.replace(/\/+$/, ''))) return;
  const oid = new URL(loc.href).searchParams.get('oid');
  if (!oid) return; // Keep ordinary lead/legacy thank-you visits intact.
  const title = doc.querySelector('h1 .text-block-wrap-div') || doc.querySelector('h1');
  if (!title) return;
  const region=doc.createElement('section');region.setAttribute('role','status');region.dataset.paymentReturn='';region.className='storefront-payment-return';
  const message=doc.createElement('p'), retry=doc.createElement('button');
  retry.type='button';retry.textContent='Проверить оплату';
  region.append(message,retry);
  if (loc.pathname.replace(/\/+$/, '') === '/pay-return') {
    const back=doc.createElement('a');back.href='/';back.textContent='Вернуться в магазин';region.append(back);
  }
  title.closest('h1').after(region);
  let pending, endpoint;
  try {storage ||= globalThis.sessionStorage;pending=JSON.parse(storage.getItem(pendingKey)||'null');if(pending?.payload?.orderId!==oid)pending=JSON.parse(storage.getItem(receiptKey)||'null');endpoint=paymentEndpoint();} catch {}
  if (!pending?.payload || pending.payload.orderId!==oid || pending.payload.paymentMethod!=='card' || pending.endpoint!==endpoint) {
    title.textContent=loc.pathname.replace(/\/+$/, '')==='/pay-return'?'Оплата не завершена':'Статус оплаты требует проверки';message.textContent='Не удалось найти данные этого заказа в текущей вкладке. Если деньги списаны, свяжитесь с нами и укажите номер заказа '+oid+'.';retry.hidden=true;return;
  }
  let busy=false, attempts=0, timer;
  const check=async()=>{
    if(busy)return;busy=true;retry.disabled=true;title.textContent='Проверяем оплату';message.textContent='Уточняем статус заказа в банке…';
    try {
      const result=await request(endpoint+'?action=order-status',pending.payload,{timeoutMs:20000});
      if (result.ok!==true || result.orderId!==oid || typeof result.paid!=='boolean')throw new Error('Unconfirmed order status');
      if(result.paid===true && result.status==='paid') {
        title.textContent='Заказ оплачен';message.textContent='Заказ № '+oid+' оплачен. Мы скоро свяжемся с вами.';
        // Do not erase products added/changed after going to the bank.
        try {storage.setItem(receiptKey,JSON.stringify(pending));} catch {}
        if(samePurchasedCart(cart.getItems(),pending.payload)) {try {cart.clear();} catch {}}
        try {
          const current=JSON.parse(storage.getItem(pendingKey)||'null');
          if(current?.payload?.orderId===oid){storage.removeItem(pendingKey);storage.removeItem(draftKey);}
        } catch {}
        retry.hidden=true;clearTimeout(timer);return;
      }
      if(result.paid===true)throw new Error('Contradictory payment response');
      title.textContent=result.status==='refunded'?'Оплата возвращена':result.status==='cancelled'?'Оплата не завершена':'Ожидаем подтверждение оплаты';
      message.textContent='Корзина и данные заказа сохранены. Если вы уже оплатили заказ, повторите проверку позже.';
      // Three public checks at most; ongoing confirmation is handled by the server worker.
      if(result.status==='awaiting_payment' && ++attempts<3)timer=setTimeout(check,60000);
    } catch {
      title.textContent='Статус оплаты пока недоступен';message.textContent='Корзина сохранена. Если деньги списаны, не оплачивайте повторно: повторите проверку или свяжитесь с нами.';
    } finally {busy=false;retry.disabled=false;}
  };
  retry.addEventListener('click',()=>{clearTimeout(timer);void check();});
  void check();
  return ()=>clearTimeout(timer);
}
