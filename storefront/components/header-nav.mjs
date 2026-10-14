// Approved header destinations and static catalog badge, shared by every generated page.
export const headerDestinations = {
  trees: '/catalog/', decor: '/catalog-tree/', landscape: '/catalog/landscape-gardening/',
  toys: 'https://kolomeev.shop/?utm_source=lady-elka',
  reviews: '/#i283ohlw3_0', faq: '/#ir3e8u570_0', installment: '/#ingttdzhn_0', delivery: '/#ifm28hfzl_0',
};
export const catalogBadge = '+2';
const text = label => '<span class="menu__link-text site__h4 color__h2 text-hover"><span class="text-block-wrap-div">'+label+'</span></span>';
const badge = id => '<span class="text tabs-dot__header text--u-i83kg91sr" '+(id?'id="'+id+'"':'')+' aria-hidden="true"><span class="text-block-wrap-div">'+catalogBadge+'</span></span>';
export function renderHeaderNav() {
  const d=headerDestinations;
  return '<div class="menu__list-lvl1 tabs-wrapper__header menu__list-lvl1--u-i5tul5ij4 menu__list-lvl1--s2-i5tul5ij4" id="i5tul5ij4_0" data-header-nav>'+
    '<div class="menu__item-lvl1 menu__item-lvl1--u-idj509tbi" data-catalog-dropdown>'+
    '<button type="button" class="menu__link-lvl1 tabs__header" id="iodmf865s_0" data-catalog-toggle aria-expanded="false" aria-controls="header-catalog-links" aria-label="Каталог '+catalogBadge+'">'+text('Каталог')+badge('i83kg91sr_0')+'<span class="header-catalog-arrow" aria-hidden="true"></span></button>'+
    '<div id="header-catalog-links" data-catalog-links hidden aria-label="Разделы каталога">'+
    '<a class="header-catalog-link tabs__header" href="'+d.trees+'" aria-label="Ёлки '+catalogBadge+'">'+text('Ёлки')+badge()+'</a>'+
    '<a class="header-catalog-link tabs__header" href="'+d.toys+'" target="_blank" rel="noopener">'+text('Ёлочные игрушки')+'</a>'+
    '<a class="header-catalog-link tabs__header" href="'+d.decor+'">'+text('Декор')+'</a>'+
    '<a class="header-catalog-link tabs__header" href="'+d.landscape+'">'+text('Искусственное озеленение')+'</a></div></div>'+
    [['reviews','Отзывы'],['faq','FAQ'],['installment','Рассрочка'],['delivery','Доставка']].map(([key,label],i)=>'<div class="menu__item-lvl1 menu__item-lvl1--u-idj509tbi"><a href="'+d[key]+'" class="menu__link-lvl1 tabs__header" id="iodmf865s_'+(i+3)+'">'+text(label)+'</a></div>').join('')+'</div>';
}
export function applyHeaderNav(html) {
  const opening=/<div\b[^>]*\bid=['"]i5tul5ij4_0['"][^>]*>/.exec(html);
  if (!opening) return html;
  const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=opening.index+opening[0].length;
  let depth=1;
  for(let tag;(tag=tags.exec(html));){depth+=tag[0].startsWith('</')?-1:1;if(!depth)return html.slice(0,opening.index)+renderHeaderNav()+html.slice(tags.lastIndex);}
  throw Error('Unbalanced shared header');
}
