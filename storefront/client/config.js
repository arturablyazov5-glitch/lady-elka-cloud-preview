function config() {
  const value = globalThis.__LE_STOREFRONT_CONFIG__;
  if (!value || !['preview', 'production'].includes(value.mode)) throw new Error('Конфигурация витрины отсутствует');
  return value;
}
export function catalogEndpoint(name) {
  const endpoint = config().catalog?.[name];
  if (!endpoint) throw new Error('Источник каталога не настроен');
  return endpoint;
}
export function paymentEndpoint() {
  const endpoint = config().payment;
  if (!endpoint) throw new Error('Оформление заказов отключено в локальном просмотре.');
  return endpoint;
}

export function leadEndpoint() {
  // Legacy catalog embeds share the same client; storefront preview stays explicit.
  const settings = globalThis.__LE_STOREFRONT_CONFIG__;
  if (!settings) return 'https://mgnotvaahftrbifqtahf.supabase.co/functions/v1/lead';
  if (!settings.lead) throw new Error('Отправка заявок отключена в локальном просмотре.');
  return settings.lead;
}
