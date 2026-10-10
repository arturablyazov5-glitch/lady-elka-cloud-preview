// Конфигурация каталога: источники данных и CSS-селекторы Taptop.

// Публичные CSV нового сервиса каталога:
export const SHEET_CSV_URL = 'https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-feeds/trees.csv'; // Ёлки (+ туи)
export const DECOR_SHEET_CSV_URL = 'https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-feeds/decor.csv'; // Декор

// Промокоды. Сервис каталога отдаёт тот же формат: .../feeds/promos.csv
export const PROMO_SHEET_CSV_URL = 'https://mgnotvaahftrbifqtahf.supabase.co/storage/v1/object/public/le-catalog-feeds/promos.csv';

// Селекторы карточки и обёрток фотографий в разметке Taptop
export const CARD_SEL = '.product-card, .product-wrapper__cms';        // карточка товара
export const IMG_WRAP_SEL = '.product__img, .product__img__cms';      // обёртки главных картинок (по категориям)
export const EXTRA_IMG_WRAP_SEL = '.product__img-dop, .product__img-dop__cms'; // обёртки «Ещё фото»
