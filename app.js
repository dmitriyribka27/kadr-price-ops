
const $=id=>document.getElementById(id);
const money=n=>Number.isFinite(n)?n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₾':'—';
const pct=n=>Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:1,minimumFractionDigits:1})+'%':'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>v===''||v===null?NaN:Number(v);
const nonneg=v=>Number.isFinite(number(v))?Math.max(0,number(v)):0;
const count=v=>Math.max(1,Math.floor(nonneg(v)||1));
const KEY='kadr-price-ops-v1';
let state,defaults,selected='PH10',editing=null,toastTimer;
const db={
 open(){return new Promise((res,rej)=>{const q=indexedDB.open(KEY,1);q.onupgradeneeded=()=>q.result.createObjectStore('state');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})},
 async get(key='data'){const d=await this.open();return new Promise((res,rej)=>{const q=d.transaction('state','readonly').objectStore('state').get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})},
 async put(value,key='data'){const d=await this.open();return new Promise((res,rej)=>{const t=d.transaction('state','readwrite');t.objectStore('state').put(value,key);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
};
let pending=Promise.resolve();
function save(){const snapshot=structuredClone(state);pending=pending.then(()=>db.put(snapshot)).catch(e=>notify('Ошибка сохранения: '+e.message))}
function notify(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3300)}
function valid(data){
 if(!data||!Array.isArray(data.skus)||!Array.isArray(data.materials)||data.skus.length>10000||data.materials.length>1000)throw Error('Некорректная резервная копия');
 const ids=new Set(),mids=new Set();
 const materials=data.materials.map(m=>{
  if(!m||!m.id||!m.name||mids.has(m.id)||m.sheetCost!==null&&(!Number.isFinite(Number(m.sheetCost))||Number(m.sheetCost)<0)||!Number.isFinite(Number(m.inkCost))||Number(m.inkCost)<0)throw Error('Неверный материал');
  mids.add(m.id);return {id:String(m.id),name:String(m.name),sheetCost:m.sheetCost===null?null:Number(m.sheetCost),inkCost:Number(m.inkCost),note:String(m.note||'')};
 });
 const skus=data.skus.map(s=>{
  if(!s||!s.id||!s.name||!s.category||ids.has(s.id)||!Number.isInteger(Number(s.units))||Number(s.units)<1||!Number.isInteger(Number(s.yield))||Number(s.yield)<1)throw Error('Неверный SKU');
  ids.add(s.id);
  const tiers=(Array.isArray(s.tiers)?s.tiers: [{from:1,to:null,price:s.price}]).map(t=>({from:Number(t.from),to:t.to==null?null:Number(t.to),price:Number(t.price)})).sort((a,b)=>a.from-b.from);
  if(!tiers.length||tiers.some(t=>!Number.isInteger(t.from)||t.from<1||t.to!==null&&(!Number.isInteger(t.to)||t.to<t.from)||!Number.isFinite(t.price)||t.price<0))throw Error('Неверные тарифы '+s.id);
  for(let i=1;i<tiers.length;i++)if(tiers[i-1].to===null||tiers[i-1].to>=tiers[i].from)throw Error('Пересечение тарифов '+s.id);
  return {id:String(s.id),category:String(s.category),name:String(s.name),unit:String(s.unit||'шт.'),units:Number(s.units),yield:Number(s.yield),material:String(s.material||'NONE'),tiers,price:tiers[0].price,note:String(s.note||'')};
 });
 return {version:3,materials,skus}
}
const sku=()=>state.skus.find(s=>s.id===selected);
const categoryList=()=>[...new Set(state.skus.map(x=>x.category))].sort((a,b)=>a.localeCompare(b,'ru'));
const tariff=(s,q)=>s.tiers.find(t=>q>=t.from&&(t.to===null||q<=t.to))?.price??null;
const tariffLabel=s=>s.tiers.map(t=>(t.to===null?'от '+t.from:t.from===t.to?t.from:t.from+'–'+t.to)+' шт. — '+money(t.price)).join(' / ');
function materialCalc(s,q){
 if(s.material==='NONE')return {cost:0,sheets:0,unknown:false};
 const sheets=Math.ceil(s.units*q/s.yield),m=state.materials.find(x=>x.id===s.material);
 if(!m||m.sheetCost===null)return {cost:NaN,sheets,unknown:true};
 return {cost:sheets*(m.sheetCost+m.inkCost),sheets,unknown:false}
}
function calc(s,q,discount,labor,extra,customPrice=null){
 const price=s.id==='DS-CUSTOM'&&customPrice!==null?customPrice:tariff(s,q),mat=materialCalc(s,q),revenue=price===null?NaN:price*q-discount;
 const total=mat.cost+labor+extra,profit=revenue-total;
 return {...mat,price,units:s.units*q,revenue,total,profit,margin:revenue>0?profit/revenue*100:NaN}
}
function options(target,items,selectedValue){
 target.innerHTML=items.map(x=>'<option value="'+esc(x[0])+'">'+esc(x[1])+'</option>').join('');
 if(items.some(x=>x[0]===selectedValue))target.value=selectedValue;
}
function renderCategories(){
 let cat=$('category-filter').value,searchCat=$('catalog-category').value;
 const vals=[['','Все категории'],...categoryList().map(x=>[x,x])];
 options($('category-filter'),vals,cat);options($('catalog-category'),vals,searchCat)
}
function renderSKU(){
 const category=$('category-filter').value;
 const list=state.skus.filter(s=>!category||s.category===category);
 options($('sku-select'),list.map(s=>[s.id,s.name]),selected);
 selected=$('sku-select').value||'';
 toggleCustomPrice();update()
}
function toggleCustomPrice(){
 const custom=sku()?.id==='DS-CUSTOM';
 $('custom-price-wrap').hidden=!custom;
 if(custom && $('custom-price').value==='')$('custom-price').value=tariff(sku(),1)??30;
}
function update(){
 const s=sku();if(!s){$('sku-description').textContent='Добавьте SKU в каталоге';return}
 const q=count($('quantity').value),discount=nonneg($('discount').value),labor=nonneg($('labor').value),extra=nonneg($('extras').value);
 const customPrice=s.id==='DS-CUSTOM'?number($('custom-price').value):null;
 const r=calc(s,q,discount,labor,extra,customPrice===null?null:(Number.isFinite(customPrice)&&customPrice>=0?customPrice:NaN));
 $('sku-description').textContent=s.id+' • '+s.units+' изд. / SKU • '+(s.id==='DS-CUSTOM'?'индивидуальная цена задаётся ниже':tariffLabel(s))+(s.note?' • '+s.note:'');
 $('revenue-value').textContent=money(r.revenue);
 $('materials-value').textContent=money(r.cost);
 $('cost-value').textContent=money(r.total);
 $('profit-value').textContent=money(r.profit);
 $('margin-value').textContent=pct(r.margin);
 $('units-value').textContent=r.units;
 $('sheets-value').textContent=r.sheets;
 $('unit-price-value').textContent=r.price===null?'Нет тарифа':money(r.price);
 $('overhead-value').textContent=money(labor+extra);
 $('discount-value').textContent=money(discount);
 $('profit-value').classList.toggle('negative',Number.isFinite(r.profit)&&r.profit<0);
 $('profit-status').textContent=s.id==='DS-CUSTOM'&&(!Number.isFinite(customPrice)||customPrice<0)?'Укажите розничную цену':r.price===null?'Тариф не утверждён':r.unknown?'Материал без закупочной цены':r.revenue<=0?'Скидка слишком большая':r.profit<0?'Убыточный заказ':r.margin<20?'Низкая маржа':'Расчёт готов';
 const warnings=[];
 if(s.id==='DS-CUSTOM'&&(!Number.isFinite(customPrice)||customPrice<0))warnings.push('Введите корректную розничную цену индивидуального дизайна.');
 if(r.price===null)warnings.push('Для выбранного количества пока нет утверждённого тарифа. Измените количество или задайте тариф в каталоге.');
 if(r.unknown)warnings.push('Неизвестна цена бумаги '+s.material+'. Внесите стоимость одного листа в разделе «Материалы».');
 if(Number.isFinite(r.revenue)&&r.revenue<=0)warnings.push('Скидка обнуляет или превышает выручку.');
 if(labor===0)warnings.push('Работа указана как 0 ₾ — фактическая прибыль может быть ниже.');
 if(s.id==='CANVAS'&&extra===0)warnings.push('Для холста внесите стоимость холста, клея, красок и декора в прочие затраты.');
 $('calc-warning').hidden=!warnings.length;$('calc-warning').textContent=warnings.join(' ');
}
function renderCatalog(){
 const search=$('sku-search').value.trim().toLowerCase(),cat=$('catalog-category').value;
 const rows=state.skus.filter(s=>(!cat||s.category===cat)&&(!search||(s.name+' '+s.id+' '+s.category).toLowerCase().includes(search)));
 $('sku-table').innerHTML=rows.map(s=>{
 const q=s.tiers[0].from,m=materialCalc(s,q),rev=s.tiers[0].price*q;
 return '<tr><td>'+esc(s.name)+'<small>'+esc(s.id)+' · '+esc(tariffLabel(s))+'</small></td><td class="price">'+money(s.tiers[0].price)+'/SKU</td><td class="material-cost">'+money(m.cost)+'</td><td class="gross">'+money(rev-m.cost)+'</td><td><div class="actions"><button class="tiny" data-edit="'+esc(s.id)+'">Изменить</button><button class="tiny remove" data-remove="'+esc(s.id)+'">×</button></div></td></tr>'
 }).join('')||'<tr><td colspan="5">SKU не найдены</td></tr>'
}
function renderMaterials(){
 $('materials-list').innerHTML=state.materials.map(m=>'<div class="material-item"><div><strong>'+esc(m.name)+'</strong><small>'+esc(m.id)+' · '+esc(m.note)+'</small></div><div class="material-values"><b>'+(m.sheetCost===null?'НЕТ ЦЕНЫ':money(m.sheetCost+m.inkCost)+'/лист')+'</b><button class="tiny" data-medit="'+esc(m.id)+'">Изменить</button><button class="tiny remove" data-mremove="'+esc(m.id)+'">×</button></div></div>').join('')
}
function page(p){
 document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===p));
 document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.page===p));
 const labels={calculator:['Калькулятор','Цена автоматически зависит от количества.'],catalog:['Каталог SKU','16 позиций, редактируемые тарифы по тиражам.'],materials:['Материалы','Расход листов и чернил.'],settings:['Данные','Локальные копии и восстановление.']};
 $('page-title').textContent=labels[p][0];$('page-subtitle').textContent=labels[p][1];
 if(p==='catalog')renderCatalog();if(p==='materials')renderMaterials()
}
function field(name,title,value,type='text',extra=''){
 return '<label class="dialog-field"><span>'+esc(title)+'</span><input class="dialog-input" name="'+name+'" type="'+type+'" value="'+esc(value??'')+'" '+extra+' /></label>'
}
function openDialog(kind,id){
 editing={kind,id};const obj=(kind==='sku'?state.skus:state.materials).find(x=>x.id===id);
 $('dialog-title').textContent=(obj?'Изменить ':'Добавить ')+(kind==='sku'?'SKU':'материал');
 let content='';
 if(kind==='sku'){
 const s=obj||{id:'',name:'',category:'',unit:'шт.',units:1,price:0,yield:1,material:'NONE',tiers:[{from:1,to:null,price:0}],note:''};
 const text=s.tiers.map(t=>(t.to===null?t.from+'+':t.from===t.to?t.from:t.from+'-'+t.to)+':'+t.price).join(';');
 content=field('id','Уникальный код SKU',s.id,'text',obj?'readonly':'required')+
 field('category','Категория',s.category,'text','required')+
 field('name','Название',s.name,'text','required')+
 field('unit','Единица',s.unit,'text','required')+
 field('units','Изделий в одном SKU',s.units,'number','min="1" step="1" required')+
 field('yield','Изделий с листа',s.yield,'number','min="1" step="1" required')+
 '<label class="dialog-field"><span>Материал</span><select class="dialog-input" name="material"><option value="NONE">Без материалов</option>'+state.materials.map(m=>'<option value="'+esc(m.id)+'" '+(s.material===m.id?'selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label>'+
 field('tiers','Тарифы (пример: 1-49:0.5;50+:0.45)',text,'text','required')+
 field('note','Примечание',s.note);
 }else{
 const m=obj||{id:'',name:'',sheetCost:null,inkCost:0,note:''};
 content=field('id','Код материала',m.id,'text',obj?'readonly':'required')+field('name','Название',m.name,'text','required')+
 field('sheetCost','Бумага за лист, ₾ (пусто = неизвестно)',m.sheetCost,'number','min="0" step="0.001"')+
 field('inkCost','Чернила за лист, ₾',m.inkCost,'number','min="0" step="0.001" required')+field('note','Примечание',m.note)
 }
 $('dialog-fields').innerHTML=content;$('edit-dialog').showModal()
}
function parseTiers(source){
 const arr=source.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{
 const m=x.match(/^(\d+)(?:-(\d+)|\+)?\s*:\s*(\d+(?:[.,]\d+)?)$/);
 if(!m)throw Error('Неверный формат. Пример: 1-49:0.5;50+:0.45');
 const from=Number(m[1]),to=m[2]?Number(m[2]):x.includes('+')?null:from,price=Number(m[3].replace(',','.'));
 if(from<1||to!==null&&to<from||price<0)throw Error('Проверьте диапазоны и цены');
 return {from,to,price}
 }).sort((a,b)=>a.from-b.from);
 if(!arr.length)throw Error('Добавьте тариф');
 for(let i=1;i<arr.length;i++)if(arr[i-1].to===null||arr[i-1].to>=arr[i].from)throw Error('Диапазоны пересекаются');
 return arr
}
function saveDialog(e){
 e.preventDefault();
 try{
 const values=Object.fromEntries(new FormData($('edit-form')).entries());
 const collection=editing.kind==='sku'?state.skus:state.materials;
 const index=collection.findIndex(x=>x.id===editing.id);
 let item;
 if(editing.kind==='sku'){
  const tiers=parseTiers(values.tiers);
  item={id:values.id.trim(),name:values.name.trim(),category:values.category.trim(),unit:values.unit.trim(),units:count(values.units),yield:count(values.yield),material:values.material,tiers,price:tiers[0].price,note:values.note||''};
 }else{
  item={id:values.id.trim(),name:values.name.trim(),sheetCost:values.sheetCost===''?null:nonneg(values.sheetCost),inkCost:nonneg(values.inkCost),note:values.note||''}
 }
 if(!item.id||!item.name||(editing.kind==='sku'&&!item.category))throw Error('Заполните обязательные поля');
 if(collection.some((x,i)=>x.id===item.id&&i!==index))throw Error('Такой код уже существует');
 if(index>=0)collection[index]=item;else collection.push(item);
 save();$('edit-dialog').close();renderCategories();renderSKU();renderCatalog();renderMaterials();notify('Сохранено')
 }catch(err){notify(err.message)}
}
function remove(kind,id){
 const collection=kind==='sku'?state.skus:state.materials,obj=collection.find(x=>x.id===id);if(!obj)return;
 if(kind==='material'&&state.skus.some(s=>s.material===id)){notify('Материал используется. Сначала измените привязку SKU.');return}
 if(!confirm('Удалить «'+obj.name+'»?'))return;
 state[kind==='sku'?'skus':'materials']=collection.filter(x=>x.id!==id);
 if(selected===id)selected=state.skus[0]?.id||'';
 save();renderCategories();renderSKU();renderCatalog();renderMaterials();notify('Удалено')
}
function download(data,name){
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)
}
async function importFile(file){
 if(!file)return;
 try{
 if(file.size>5*1024*1024)throw Error('Файл превышает 5 МБ');
 const incoming=valid(JSON.parse(await file.text()));
 if(!confirm('Заменить текущий каталог и материалы данными из файла?'))return;
 await db.put(structuredClone(state),'before-import-v2');
 state=incoming;await db.put(state);selected=state.skus[0]?.id||'';
 renderCategories();renderSKU();renderCatalog();renderMaterials();notify('Данные восстановлены');
 }catch(err){notify('Ошибка импорта: '+err.message)}
 finally{$('import-data').value=''}
}
function events(){
 document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
 $('category-filter').addEventListener('change',renderSKU);
 $('sku-select').addEventListener('change',e=>{selected=e.target.value;toggleCustomPrice();update()});
 ['quantity','discount','labor','extras','custom-price'].forEach(k=>$(k).addEventListener('input',update));
 $('reset-calculator').addEventListener('click',()=>{['discount','labor','extras'].forEach(k=>$(k).value=0);$('quantity').value=1;update()});
 $('copy-result').addEventListener('click',async()=>{
 const s=sku(),r=calc(s,count($('quantity').value),nonneg($('discount').value),nonneg($('labor').value),nonneg($('extras').value),s.id==='DS-CUSTOM'?number($('custom-price').value):null);
 const txt='КАДР / '+s.name+' × '+$('quantity').value+'\nЦена: '+money(r.price)+'\nВыручка: '+money(r.revenue)+'\nМатериалы: '+money(r.cost)+'\nРабота: '+money(nonneg($('labor').value))+'\nПрочие: '+money(nonneg($('extras').value))+'\nПрибыль: '+money(r.profit)+'\nМаржа: '+pct(r.margin);
 try{await navigator.clipboard.writeText(txt);notify('Расчёт скопирован')}catch{notify('Копирование недоступно')}
 });
 $('sku-search').addEventListener('input',renderCatalog);$('catalog-category').addEventListener('change',renderCatalog);
 $('add-sku').addEventListener('click',()=>openDialog('sku'));$('add-material').addEventListener('click',()=>openDialog('material'));
 $('sku-table').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.edit)openDialog('sku',b.dataset.edit);if(b.dataset.remove)remove('sku',b.dataset.remove)});
 $('materials-list').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.medit)openDialog('material',b.dataset.medit);if(b.dataset.mremove)remove('material',b.dataset.mremove)});
 $('edit-form').addEventListener('submit',saveDialog);$('close-dialog').addEventListener('click',()=>$('edit-dialog').close());$('cancel-dialog').addEventListener('click',()=>$('edit-dialog').close());
 $('export-data').addEventListener('click',()=>{download(state,'KADR_BACKUP_'+new Date().toISOString().slice(0,10)+'.json');notify('Копия сохранена')});
 $('import-data').addEventListener('change',e=>importFile(e.target.files[0]));
 $('reset-all').addEventListener('click',async()=>{if(!confirm('Вернуть начальный прайс? Ваши изменения будут заменены, сначала скачайте JSON.'))return;await db.put(state,'before-reset-v2');state=structuredClone(defaults);await db.put(state);selected='PH10';renderCategories();renderSKU();renderCatalog();renderMaterials();notify('Исходный прайс восстановлен')});
}
async function main(){
 try{
 const response=await fetch('./seed.json',{cache:'no-store'});if(!response.ok)throw Error('Не загружен каталог');
 defaults=valid(await response.json());
 const stored=await db.get();
 if(stored?.version===3)state=valid(stored);
 else if(stored?.version===2){
  await db.put(stored,'legacy-v2');
  const old=valid(stored);
  const changes=new Set(['BUS','CERT-A6','CERT-A5','CERT-A4','CARD-A6','DS-CUSTOM']);
  const toRemove=new Set(['DS-ST-AD','DS-AD','DS-NEW','CANVAS']);
  state={version:3,materials:old.materials,skus:old.skus.filter(s=>!toRemove.has(s.id)).map(s=>{
    const updated=defaults.skus.find(d=>d.id===s.id);
    return updated&&changes.has(s.id)?{...s,tiers:structuredClone(updated.tiers),price:updated.price,note:updated.note}:s;
  })};
  await db.put(state);
 }else{
  if(stored)await db.put(stored,'legacy-v1');
  state=structuredClone(defaults);await db.put(state);
 }
 events();renderCategories();renderSKU();renderCatalog();renderMaterials();
 for(const version of [1,2]){
  const legacy=await db.get('legacy-v'+version);
  if(legacy){
   const box=document.querySelector('#settings .panel');
   const b=document.createElement('button');b.className='button secondary';b.textContent='Скачать старый каталог v'+version+' (резерв)';
   b.addEventListener('click',()=>download(legacy,'KADR_OLD_CATALOG_V'+version+'.json'));box.appendChild(b)
  }
 }
 }catch(e){document.querySelector('main').innerHTML='<div class="panel"><h2>Ошибка загрузки</h2><p>'+esc(e.message)+'</p></div>'}
}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
main();
