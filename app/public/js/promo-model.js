// Промокоды: правила, общие для сервера и браузера (как pricing.js).
// Нормализация повторяет norm() из скрипта сайта: регистр, «ё» и пробелы не важны.
export const normalizeCode=s=>String(s??'').trim().toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ');
export const GIFT_TEXT='Сумка для хранения';
// Промокод либо работает на сайте, либо выключен: скрипт сайта больше ничего не умеет.
export const promoStatus=p=>p.active?'live':'off';
export const isLive=p=>!!p.active;
export const discountLabel=p=>[p.rub>0?`−${p.rub.toLocaleString('ru-RU')} ₽`:p.pct>0?`−${p.pct}%`:'',p.gift?'+ сумка':''].filter(Boolean).join(' ');
// Сайт вычитает рубли, иначе умножает на процент, и никогда не уходит ниже нуля.
export const promoTotal=(p,total)=>p.rub>0?Math.max(0,total-p.rub):p.pct>0?Math.max(0,Math.round(total*(1-p.pct/100))):total;
export function validatePromo(input){
 if(!input || typeof input!=='object') throw new Error('Некорректный промокод');
 const code=String(input.code??'').trim();
 if(!code) throw new Error('Введите промокод');
 if(code.length>40) throw new Error('Промокод не длиннее 40 символов');
 if(!/^[\p{L}\p{N}_-]+$/u.test(code)) throw new Error('В промокоде только буквы, цифры, дефис и подчёркивание — без пробелов и запятых');
 const comment=String(input.comment??'').trim();
 if(comment.length>200) throw new Error('Комментарий не длиннее 200 символов');
 const rub=input.rub===''||input.rub==null?0:Number(input.rub),pct=input.pct===''||input.pct==null?0:Number(input.pct);
 if(!Number.isInteger(rub)||rub<0||rub>1000000) throw new Error('Скидка в рублях — целое число от 0 до 1 000 000');
 if(!Number.isFinite(pct)||pct<0||pct>=100||Math.round(pct*100)!==pct*100) throw new Error('Скидка в процентах — число от 0 до 99,99');
 if(rub>0&&pct>0) throw new Error('Выберите одну скидку: либо в рублях, либо в процентах. Сайт применяет только рубли, если заполнено и то и другое.');
 const gift=!!input.gift;
 if(!rub&&!pct&&!gift) throw new Error('Укажите скидку или включите подарок — иначе промокод ничего не даёт');
 return {code,comment,rub,pct,gift,active:input.active!==false};
}
