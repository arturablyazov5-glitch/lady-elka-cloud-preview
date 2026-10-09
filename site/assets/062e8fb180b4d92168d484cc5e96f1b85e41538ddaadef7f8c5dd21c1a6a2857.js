(() => {
  const query = new URLSearchParams(location.search).get('search') || '';
  const normalized = value => String(value || '').toLocaleLowerCase('ru')
    .replaceAll('ё', 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
  const terms = normalized(query).split(' ').filter(Boolean);
  const page = Math.max(0, Number(location.pathname.match(/\/search\/p\/(\d+)/)?.[1] || 0));
  const count = document.querySelector('.search-result__count .value__search .text-block-wrap-div');
  const list = document.querySelector('.search-result__list');
  const controls = document.querySelector('.search-result__controls');
  document.querySelectorAll('form[action="/search"] input[name="search"]').forEach(input => { input.value = query; });
  if (!count || !list || !controls) return;

  const link = (path, text, className) => {
    const a = document.createElement('a');
    a.href = path;
    a.className = className;
    const span = document.createElement('span');
    span.className = 'text-block-wrap-div';
    span.textContent = text;
    a.append(span);
    return a;
  };
  list.addEventListener('click', event => {
    const card = event.target.closest('[data-search-path]');
    if (!card || event.target.closest('a,button,select,input,label,[role="button"]')) return;
    event.preventDefault(); event.stopPropagation();
    location.assign(card.dataset.searchPath);
  });
  fetch('/search-index.json')
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(index => {
      const matches = terms.length ? index.map(item => {
        const title = normalized(item.title);
        const path = normalized(item.path.replaceAll('-', ' '));
        const description = normalized(item.description);
        if (!terms.every(term => title.includes(term) || path.includes(term) || description.includes(term))) return null;
        const exact = title === normalized(query) || path.endsWith('/' + normalized(query));
        return { ...item, score: exact ? 100 : title.includes(normalized(query)) ? 50 : 10 };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru')) : [];
      count.textContent = String(matches.length);
      list.replaceChildren();
      for (const item of matches.slice(page * 10, page * 10 + 10)) {
        if (item.kind === 'product' && item.cardHtml) {
          const template = document.createElement('template');
          template.innerHTML = item.cardHtml;
          const card = template.content.firstElementChild;
          card.dataset.searchPath = item.path;
          list.append(card);
        } else {
          const card = document.createElement('article');
          card.className = 'search-content-card';
          const type = document.createElement('p');
          type.className = 'search-card-type';
          type.textContent = item.kind === 'article' ? 'Статья' : item.kind === 'product' ? 'Товар недоступен' : 'Страница';
          const heading = document.createElement('h2');
          heading.append(link(item.path, item.title, 'search-card-title'));
          const text = document.createElement('p');
          text.textContent = (item.description || '').slice(0, 220);
          card.append(type, heading, text, link(item.path, 'Подробнее', 'search-card-more'));
          list.append(card);
        }
      }
      document.dispatchEvent(new Event('storefront:products-added'));
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'search-empty';
        empty.textContent = query ? 'Ничего не найдено' : 'Введите запрос';
        list.append(empty);
      }
      controls.replaceChildren();
      const pages = Math.ceil(matches.length / 10);
      if (pages > 1) {
        const pagination = document.createElement('div');
        pagination.className = 'search-result__pagination';
        for (let number = 0; number < pages; number++) {
          const wrapper = document.createElement('div');
          wrapper.className = 'search-result__pagination-item' + (number === page ? ' is-active' : '');
          const path = number ? `/search/p/${number}` : '/search';
          wrapper.append(link(`${path}?search=${encodeURIComponent(query)}`, String(number + 1), 'search-result__page-link'));
          pagination.append(wrapper);
        }
        controls.append(pagination);
        if (page + 1 < pages) controls.append(link(`/search/p/${page + 1}?search=${encodeURIComponent(query)}`, 'Следующая', 'search-result__next-page'));
      }
    })
    .catch(() => {
      count.textContent = '0';
      list.textContent = 'Не удалось загрузить результаты поиска';
      controls.replaceChildren();
    });
})();
