// Local contract only. No endpoint, storage, provider or checkout activation.
export const API_VERSION = '2';
export const FINGERPRINT_VERSION = 'sha256-canonical-json-v1';
export class ContractError extends Error {
  constructor(code, status = 400) {
    super(code); this.name = 'ContractError'; this.code = code; this.status = status;
    this.preservePending = true;
  }
}
// Only for a NEW order, before building/persisting its payload; never for replay.
export function createV2OrderId(timestamp, nonce) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 1000000000 || !/^[a-f0-9]{8}$/.test(nonce)) throw new ContractError('ORDER_ID_INVALID');
  const id = `LE-${timestamp}-V2-${nonce}`;
  if (id.length > 32) throw new ContractError('ORDER_ID_INVALID');
  return id;
}
const reject = (code, status) => { throw new ContractError(code, status); };
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const exact = (x, keys) => record(x) && Object.keys(x).every(k => keys.includes(k));
const string = (x, max, required = true) => typeof x === 'string' && x.length <= max && (!required || !!x.trim());
// Matches order-store.mjs for JSON payloads; arrays retain their order.
export function canonicalPayload(value) {
  const visit = (x, depth = 0) => {
    if (depth > 16) reject('INVALID_JSON');
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return x;
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    if (Array.isArray(x)) {
      if (Object.keys(x).length !== x.length) reject('INVALID_JSON');
      return x.map(y => visit(y, depth + 1));
    }
    if (!record(x)) reject('INVALID_JSON');
    const descriptors = Object.getOwnPropertyDescriptors(x);
    if (Reflect.ownKeys(x).length !== Object.keys(x).length || Object.values(descriptors).some(d => !('value' in d))) reject('INVALID_JSON');
    return Object.fromEntries(Object.keys(x).sort().map(k => [k, visit(x[k], depth + 1)]));
  };
  return JSON.stringify(visit(value));
}
export async function fingerprintPayload(payload) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPayload(payload)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function endpoint(value) {
  if (!string(value, 2048)) reject('OWNER_ENDPOINT_INVALID');
  let url; try { url = new URL(value); } catch { reject('OWNER_ENDPOINT_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.href !== value || /\/pay\/?$/.test(url.pathname)
    || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) reject('OWNER_ENDPOINT_INVALID');
  return value;
}
export function validatePayload(p) {
  canonicalPayload(p);
  if (!exact(p, ['amount','description','email','phone','paymentMethod','customer','delivery','items','promo','orderId','clientId','successUrl','failUrl','promoCode','address','contactPref'])) reject('INVALID_PAYLOAD');
  if (!string(p.orderId, 64) || !/^LE-\d{10,}-[\w-]{0,32}$/.test(p.orderId)
    || (p.paymentMethod === 'card' && p.orderId.length > 32)) reject('ORDER_ID_INVALID');
  if (!['card','cash_on_delivery'].includes(p.paymentMethod) || !Number.isFinite(p.amount) || p.amount <= 0) reject('INVALID_PAYLOAD');
  if (!exact(p.customer, ['name','email','phone','address','contactPref','comment']) || !exact(p.delivery, ['address'])) reject('STRUCTURED_PAYLOAD_REQUIRED');
  for (const [k, max] of [['name',120],['email',200],['phone',40],['address',500],['contactPref',80]])
    if (!string(p.customer[k], max)) reject('INVALID_CUSTOMER');
  if (!/^\S+@\S+\.\S+$/.test(p.customer.email.trim()) || p.customer.phone.replace(/\D/g,'').length < 10
    || !string(p.delivery.address,500) || (p.customer.comment !== undefined && !string(p.customer.comment,1000,false))) reject('INVALID_CUSTOMER');
  if (p.email !== p.customer.email || p.phone !== p.customer.phone || p.address !== p.delivery.address
    || p.customer.address !== p.delivery.address || p.contactPref !== p.customer.contactPref) reject('CONFLICTING_CUSTOMER');
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 50 || p.items.some(i =>
    !exact(i,['productId','variantId','kind','quantity','price']) || !string(i.productId,200) || !string(i.variantId,200)
    || !['tree','decor'].includes(i.kind) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99
    || !Number.isFinite(i.price) || i.price <= 0)) reject('INVALID_ITEMS');
  if (p.promo !== null && (!exact(p.promo,['code','rub','pct','gift','giftText']) || !string(p.promo.code,200,false)
    || !Number.isFinite(p.promo.rub) || p.promo.rub < 0 || !Number.isFinite(p.promo.pct) || p.promo.pct < 0 || p.promo.pct > 100
    || typeof p.promo.gift !== 'boolean' || !string(p.promo.giftText,1000,false))) reject('INVALID_PROMO');
  for (const [k,max] of [['description',20000],['clientId',120],['promoCode',200]]) if (!string(p[k],max,k !== 'promoCode')) reject('INVALID_PAYLOAD');
  if (p.promoCode !== (p.promo?.code || '')) reject('INVALID_PROMO');
  for (const [k,path] of [['successUrl','/spasibo'],['failUrl','/pay-return']]) {
    let u; try { u = new URL(p[k]); } catch { reject('INVALID_RETURN_URL'); }
    if (!['https://lady-elka.ru','https://www.lady-elka.ru','http://localhost:4176','http://127.0.0.1:4176'].includes(u.origin)
      || u.username || u.password || u.hash || u.pathname !== path || u.searchParams.getAll('oid').length !== 1
      || u.searchParams.get('oid') !== p.orderId || [...u.searchParams.keys()].some(key => !['oid',...(k === 'failUrl' ? ['fail'] : [])].includes(key))
      || (k === 'failUrl' && (u.searchParams.getAll('fail').length !== 1 || u.searchParams.get('fail') !== '1'))) reject('INVALID_RETURN_URL');
  }
  return p;
}
export function validateEnvelope(e, policy) {
  if (!record(e) || !('apiVersion' in e)) reject('LEGACY_PENDING_UNSUPPORTED',409);
  if (e.apiVersion !== API_VERSION || policy?.versionExpired === true) reject('VERSION_EXPIRED',410);
  if (e.fingerprintVersion !== FINGERPRINT_VERSION) reject('FINGERPRINT_VERSION_UNSUPPORTED',409);
  if (!exact(e,['apiVersion','fingerprintVersion','ownerEndpoint','orderId','payload'])) reject('INVALID_ENVELOPE');
  if (endpoint(e.ownerEndpoint) !== endpoint(policy?.ownerEndpoint)) reject('OWNER_ENDPOINT_MISMATCH',409);
  validatePayload(e.payload);
  if (e.orderId !== e.payload.orderId) reject('ORDER_ID_CONFLICT',409);
  if (!/^LE-\d{10,}-V2-[a-f0-9]{8}$/.test(e.orderId) || e.orderId.length > 32) reject('ORDER_ID_INVALID');
  return e;
}
export function createEnvelope(payload, ownerEndpoint) {
  const e = { apiVersion: API_VERSION, fingerprintVersion: FINGERPRINT_VERSION, ownerEndpoint, orderId: payload.orderId, payload };
  validateEnvelope(e,{ownerEndpoint});
  return JSON.parse(JSON.stringify(e));
}
// Serialization never generates IDs, changes business fields or performs I/O.
export function serializePending(envelope, policy) {
  validateEnvelope(envelope,policy); return JSON.stringify(envelope);
}
export function restorePending(serialized, policy) {
  let e; try { e = JSON.parse(serialized); } catch { reject('PENDING_CORRUPT',409); }
  validateEnvelope(e,policy); return e;
}
export function assertReplay(saved, incoming, policy) {
  validateEnvelope(saved,policy); validateEnvelope(incoming,policy);
  if (saved.orderId !== incoming.orderId || canonicalPayload(saved.payload) !== canonicalPayload(incoming.payload)) reject('ORDER_ID_CONFLICT',409);
  return saved;
}
export function validateStatus(response, pending, policy) {
  validateEnvelope(pending,policy);
  if (!exact(response,['apiVersion','fingerprintVersion','ownerEndpoint','orderId','status','error'])
    || response.apiVersion !== pending.apiVersion || response.fingerprintVersion !== pending.fingerprintVersion
    || response.ownerEndpoint !== pending.ownerEndpoint || response.orderId !== pending.orderId) reject('STATUS_IDENTITY_MISMATCH',409);
  if (!['received','accepted','awaiting_payment','paid','pending_review','version_expired'].includes(response.status)) reject('STATUS_INVALID');
  if (response.error !== undefined && !['BANK_RESULT_UNKNOWN','DELIVERY_PENDING','VERSION_EXPIRED','ADMISSION_UNAVAILABLE','RATE_LIMITED'].includes(response.error)) reject('STATUS_INVALID');
  if ((response.status === 'version_expired') !== (response.error === 'VERSION_EXPIRED')
    || (response.error === 'BANK_RESULT_UNKNOWN' && response.status !== 'pending_review')
    || (response.error === 'DELIVERY_PENDING' && response.status !== 'accepted')
    || (response.status === 'paid' && response.error !== undefined)) reject('STATUS_INVALID');
  return { ...response, preservePending: true, nextAction: response.status === 'paid' ? 'confirm_paid'
    : response.status === 'accepted' && pending.payload.paymentMethod === 'cash_on_delivery' ? 'confirm_accepted'
    : response.status === 'version_expired' ? 'contact_owner' : 'status_only' };
}
