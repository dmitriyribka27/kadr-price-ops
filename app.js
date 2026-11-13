
const $=id=>document.getElementById(id);
const money=n=>Number.isFinite(n)?n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₾':'—';
const pct=n=>Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:1,minimumFractionDigits:1})+'%':'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>v===''||v===null?NaN:Number(v);
const nonneg=v=>Number.isFinite(number(v))?Math.max(0,number(v)):0;
const count=v=>Math.max(1,Math.floor(nonneg(v)||1));
const KEY='kadr-price-ops-v1';
// Pricing truth: Google Sheets. Local edits are backed up when sourceRevision changes.
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
 const mids=new Set(),ids=new Set(),pids=new Set();
 const materials=data.materials.map(m=>{
  if(!m?.id||!m.name||mids.has(m.id)||m.sheetCost!==null&&(!Number.isFinite(Number(m.sheetCost))||Number(m.sheetCost)<0))throw Error('Неверный материал');
  mids.add(m.id);
  const packCost=m.packCost==null?null:Number(m.packCost),packSize=m.packSize==null?null:Number(m.packSize);
  if(packCost!==null&&(!Number.isFinite(packCost)||packCost<0)||packSize!==null&&(!Number.isInteger(packSize)||packSize<1))throw Error('Неверная упаковка материала');
  return {id:String(m.id),name:String(m.name),sheetCost:m.sheetCost===null?null:Number(m.sheetCost),
   inkCost:Number(m.inkCost)||0,format:String(m.format||''),gsm:m.gsm==null?null:Number(m.gsm),
   packSize,packCost,status:String(m.status||''),source:String(m.source||''),note:String(m.note||'')};
 });
 const inkProfiles=(data.inkProfiles||[]).map(p=>{
  if(!p?.id||pids.has(p.id)||!Number.isFinite(Number(p.cost))||Number(p.cost)<0)throw Error('Неверный профиль чернил');
  pids.add(p.id);return {id:String(p.id),name:String(p.name||p.id),cost:Number(p.cost),note:String(p.note||'')};
 });
 const skus=data.skus.map(s=>{
  if(!s?.id||!s.name||!s.category||ids.has(s.id)||!Number.isInteger(Number(s.units))||Number(s.units)<1||!Number.isInteger(Number(s.yield))||Number(s.yield)<1)throw Error('Неверный SKU');
  ids.add(s.id);
  const tiers=(Array.isArray(s.tiers)?s.tiers:[{from:1,to:null,price:s.price}]).map(t=>({from:Number(t.from),to:t.to==null?null:Number(t.to),price:Number(t.price)})).sort((a,b)=>a.from-b.from);
  if(!tiers.length||tiers.some(t=>!Number.isInteger(t.from)||t.from<1||t.to!==null&&(!Number.isInteger(t.to)||t.to<t.from)||!Number.isFinite(t.price)||t.price<0))throw Error('Неверные тарифы '+s.id);
  for(let i=1;i<tiers.length;i++)if(tiers[i-1].to===null||tiers[i-1].to>=tiers[i].from)throw Error('Пересечение тарифов '+s.id);
  return {id:String(s.id),category:String(s.category),name:String(s.name),unit:String(s.unit||'шт.'),
   units:Number(s.units),yield:Number(s.yield),material:String(s.material||'NONE'),
   inkProfile:String(s.inkProfile||''),sides:Number.isInteger(Number(s.sides))?Number(s.sides):1,
   status:String(s.status||''),tiers,price:tiers[0].price,note:String(s.note||'')};
 });
 if(skus.some(s=>s.material!=='NONE'&&!mids.has(s.material)))throw Error('Отсутствующий материал SKU');
 if(skus.some(s=>s.inkProfile&&!pids.has(s.inkProfile)))throw Error('Отсутствующий профиль чернил SKU');
 return {version:4,sourceRevision:String(data.sourceRevision||''),sourceUrl:String(data.sourceUrl||''),materials,inkProfiles,skus}
}
const sku=()=>state.skus.find(s=>s.id===selected);
const categoryList=()=>[...new Set(state.skus.map(x=>x.category))].sort((a,b)=>a.localeCompare(b,'ru'));
const tariff=(s,q)=>s.tiers.find(t=>q>=t.from&&(t.to===null||q<=t.to))?.price??null;
const tariffLabel=s=>s.tiers.map(t=>(t.to===null?'от '+t.from:t.from===t.to?t.from:t.from+'–'+t.to)+' шт. — '+money(t.price)).join(' / ');
function materialCalc(s,q){
 if(s.material==='NONE')return {cost:0,sheets:0,unknown:false,paperCost:0,inkCost:0};
 const sheets=Math.ceil(s.units*q/s.yield),m=state.materials.find(x=>x.id===s.material);
 const profile=state.inkProfiles.find(x=>x.id===s.inkProfile);
 const inkPerSheet=profile?profile.cost*s.sides:m?.inkCost;
 if(!m||m.sheetCost===null||!Number.isFinite(inkPerSheet))return {cost:NaN,sheets,unknown:true,paperCost:NaN,inkCost:NaN};
 const paperCost=sheets*m.sheetCost,inkCost=sheets*inkPerSheet;
 return {cost:paperCost+inkCost,paperCost,inkCost,sheets,unknown:false};
}
function calc(s,q,discount,labor,extra,customPrice=null){
 const price=s.id==='DS-CUSTOM'&&customPrice!==null?customPrice:tariff(s,q),mat=materialCalc(s,q),revenue=price===null?NaN:price*q-discount;
 const total=mat.cost+extra,profit=revenue-total;
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
 const q=count($('quantity').value),discount=nonneg($('discount').value),labor=0,extra=nonneg($('extras').value);
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
 $('overhead-value').textContent=money(extra);
 $('discount-value').textContent=money(discount);
 $('profit-value').classList.toggle('negative',Number.isFinite(r.profit)&&r.profit<0);
 $('profit-status').textContent=s.id==='DS-CUSTOM'&&(!Number.isFinite(customPrice)||customPrice<0)?'Укажите розничную цену':r.price===null?'Тариф не утверждён':r.unknown?'Материал без закупочной цены':r.revenue<=0?'Скидка слишком большая':r.profit<0?'Убыточный заказ':r.margin<20?'Низкая маржа':'Расчёт готов';
 const warnings=[];
 if(s.id==='DS-CUSTOM'&&(!Number.isFinite(customPrice)||customPrice<0))warnings.push('Введите корректную розничную цену индивидуального дизайна.');
 if(r.price===null)warnings.push('Для выбранного количества пока нет утверждённого тарифа. Измените количество или задайте тариф в каталоге.');
 if(r.unknown)warnings.push('Неизвестна цена бумаги '+s.material+'. Внесите стоимость одного листа в разделе «Материалы».');
 if(Number.isFinite(r.revenue)&&r.revenue<=0)warnings.push('Скидка обнуляет или превышает выручку.');
 // Время работы по решению владельца в экономике не учитывается.

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
 $('materials-list').innerHTML=state.materials.map(m=>'<div class="material-item"><div><strong>'+esc(m.name)+'</strong><small>'+esc(m.id)+' · '+esc([m.format,m.gsm?m.gsm+' г/м²':'',m.packSize?m.packSize+' листов/пачка':'',m.status].filter(Boolean).join(' · '))+'</small></div><div class="material-values"><b>'+(m.sheetCost===null?'НЕТ ЦЕНЫ':money(m.sheetCost)+'/лист')+'</b><button class="tiny" data-medit="'+esc(m.id)+'">Изменить</button><button class="tiny remove" data-mremove="'+esc(m.id)+'">×</button></div></div>').join('')+
 '<div class="ink-profile-list"><h3>Чернила · стоимость за сторону</h3>'+state.inkProfiles.map(p=>'<div class="material-item"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.id)+' · '+esc(p.note)+'</small></div><div class="material-values"><b>'+money(p.cost)+'</b><button class="tiny" data-pedit="'+esc(p.id)+'">Изменить</button></div></div>').join('')+'</div>';
}
function page(p){
 document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===p));
 document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.page===p));
 const labels={calculator:['Калькулятор','Локальный снимок. Текущие цены сверяйте с «Прайс КАДР».'],catalog:['Каталог SKU',state.skus.length+' позиций, локальные тарифы по тиражам.'],materials:['Материалы','Локальные данные. Актуальные расчёты — в «Прайс КАДР».'],settings:['Данные','Локальные копии и восстановление.']};
 $('page-title').textContent=labels[p][0];$('page-subtitle').textContent=labels[p][1];
 if(p==='catalog')renderCatalog();if(p==='materials')renderMaterials()
}
function field(name,title,value,type='text',extra=''){
 return '<label class="dialog-field"><span>'+esc(title)+'</span><input class="dialog-input" name="'+name+'" type="'+type+'" value="'+esc(value??'')+'" '+extra+' /></label>'
}
function tierRow(t={from:1,to:null,price:0}){
 return '<div class="tier-row">'+
   '<label><span>От, шт.</span><input class="dialog-input tier-from" type="number" min="1" step="1" inputmode="numeric" required value="'+esc(t.from)+'"></label>'+
   '<label><span>До, шт.</span><input class="dialog-input tier-to" type="number" min="1" step="1" inputmode="numeric" placeholder="∞" value="'+esc(t.to??'')+'"></label>'+
   '<label><span>₾ / SKU</span><input class="dialog-input tier-price" type="number" min="0" step="0.01" inputmode="decimal" required value="'+esc(t.price)+'"></label>'+
   '<button type="button" class="tier-remove" aria-label="Удалить тариф" title="Удалить тариф">×</button>'+
 '</div>'
}
function addTierRow(){
 const box=$('tier-rows'),rows=Array.from(box.querySelectorAll('.tier-row'));
 let from=1;
 if(rows.length){
  const prev=rows[rows.length-1],fromInput=prev.querySelector('.tier-from'),toInput=prev.querySelector('.tier-to');
  const start=Number(fromInput.value)||1,end=Number(toInput.value);
  if(toInput.value===''){
   // Leave a one-unit first range so an unlimited final tier can be appended.
   toInput.value=String(start);from=start+1;
  }else from=Math.max(start,end)+1;
 }
 box.insertAdjacentHTML('beforeend',tierRow({from,to:null,price:0}));
 box.lastElementChild.querySelector('.tier-price').focus();
 updateTierRemoveButtons();
}
function updateTierRemoveButtons(){
 const rows=$('tier-rows')?.querySelectorAll('.tier-row')||[];
 rows.forEach(row=>{row.querySelector('.tier-remove').disabled=rows.length===1});
}
function parseTierRows(){
 const rows=Array.from($('tier-rows')?.querySelectorAll('.tier-row')||[]);
 if(!rows.length)throw Error('Добавьте хотя бы один тариф');
 const arr=rows.map(row=>{
  const fromText=row.querySelector('.tier-from').value.trim();
  const toText=row.querySelector('.tier-to').value.trim();
  const priceText=row.querySelector('.tier-price').value.trim();
  const from=Number(fromText),to=toText===''?null:Number(toText),price=Number(priceText);
  if(!fromText||!Number.isSafeInteger(from)||from<1)throw Error('Укажите количество «От» — целое число от 1');
  if(to!==null&&(!Number.isSafeInteger(to)||to<from))throw Error('Количество «До» не может быть меньше «От»');
  if(priceText===''||!Number.isFinite(price)||price<0)throw Error('Укажите корректную цену за SKU');
  return {from,to,price};
 }).sort((a,b)=>a.from-b.from);
 for(let i=1;i<arr.length;i++){
  if(arr[i-1].to===null)throw Error('Диапазон без верхней границы может быть только последним');
  if(arr[i-1].to>=arr[i].from)throw Error('Диапазоны тарифов пересекаются. Проверьте «От» и «До»');
 }
 return arr;
}
function openDialog(kind,id){
 editing={kind,id};const obj=(kind==='sku'?state.skus:kind==='ink'?state.inkProfiles:state.materials).find(x=>x.id===id);
 $('dialog-title').textContent=(obj?'Изменить ':'Добавить ')+(kind==='sku'?'SKU':kind==='ink'?'профиль чернил':'материал');
 let content='';
 if(kind==='sku'){
 const s=obj||{id:'',name:'',category:'',unit:'шт.',units:1,price:0,yield:1,material:'NONE',tiers:[{from:1,to:null,price:0}],note:''};
 content=field('id','Уникальный код SKU',s.id,'text',obj?'readonly':'required')+
 field('category','Категория',s.category,'text','required')+
 field('name','Название',s.name,'text','required')+
 field('unit','Единица',s.unit,'text','required')+
 field('units','Изделий в одном SKU',s.units,'number','min="1" step="1" required')+
 field('yield','Изделий с листа',s.yield,'number','min="1" step="1" required')+
 '<label class="dialog-field"><span>Материал</span><select class="dialog-input" name="material"><option value="NONE">Без материалов</option>'+state.materials.map(m=>'<option value="'+esc(m.id)+'" '+(s.material===m.id?'selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label>'+
 '<section class="tier-editor" aria-label="Тарифы по количеству"><div class="tier-header"><div><strong>Тарифы по количеству</strong><small>Пустое поле «До» = без ограничения</small></div><button type="button" class="button secondary tier-add" id="add-tier">+ Тариф</button></div><div id="tier-rows">'+s.tiers.map(tierRow).join('')+'</div><p class="tier-hint">Цена применяется ко всем SKU в заказе, когда количество попадает в диапазон.</p></section>'+
 '<label class="dialog-field"><span>Профиль чернил</span><select class="dialog-input" name="inkProfile"><option value="">Без профиля</option>'+state.inkProfiles.map(p=>'<option value="'+esc(p.id)+'" '+(s.inkProfile===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+
 field('sides','Печатных сторон на лист',s.sides||1,'number','min="0" step="1" required')+
 field('note','Примечание',s.note);
 }else if(kind==='ink'){
 const p=obj||{id:'',name:'',cost:0,note:''};
 content=field('id','Код профиля',p.id,'text','readonly')+field('name','Название',p.name,'text','required')+
 field('cost','Цена чернил за одну сторону, ₾',p.cost,'number','min="0" step="0.000001" required')+
 field('note','Основание расчёта',p.note);
 }else{
 const m=obj||{id:'',name:'',sheetCost:null,inkCost:0,format:'',gsm:null,packSize:null,packCost:null,status:'',source:'',note:''};
 content=field('id','Код материала',m.id,'text',obj?'readonly':'required')+field('name','Название',m.name,'text','required')+
 field('format','Формат',m.format)+
 field('gsm','Плотность, г/м²',m.gsm,'number','min="0" step="1"')+
 field('packSize','Листов в пачке',m.packSize,'number','min="1" step="1"')+
 field('packCost','Цена пачки, ₾',m.packCost,'number','min="0" step="0.01"')+
 field('sheetCost','Цена листа, ₾ (при отсутствии пачки)',m.sheetCost,'number','min="0" step="0.00001"')+
 field('status','Статус закупочной цены',m.status)+
 field('source','Источник',m.source)+field('note','Примечание',m.note)
 }
 $('dialog-fields').innerHTML=content;if(kind==='sku')updateTierRemoveButtons();$('edit-dialog').showModal()
}
function saveDialog(e){
 e.preventDefault();
 try{
 const values=Object.fromEntries(new FormData($('edit-form')).entries());
 const collection=editing.kind==='sku'?state.skus:editing.kind==='ink'?state.inkProfiles:state.materials;
 const index=collection.findIndex(x=>x.id===editing.id);
 let item;
 if(editing.kind==='sku'){
  const tiers=parseTierRows();
  item={id:values.id.trim(),name:values.name.trim(),category:values.category.trim(),unit:values.unit.trim(),units:count(values.units),yield:count(values.yield),material:values.material,inkProfile:values.inkProfile,sides:Math.max(0,Math.floor(nonneg(values.sides))),tiers,price:tiers[0].price,status:'',note:values.note||''};
 }else if(editing.kind==='ink'){
  item={id:values.id,name:values.name.trim(),cost:nonneg(values.cost),note:values.note||''};
 }else{
  const packSize=values.packSize===''?null:count(values.packSize),packCost=values.packCost===''?null:nonneg(values.packCost);
  const sheetCost=packSize&&packCost!==null?packCost/packSize:values.sheetCost===''?null:nonneg(values.sheetCost);
  item={id:values.id.trim(),name:values.name.trim(),format:values.format||'',gsm:values.gsm===''?null:nonneg(values.gsm),
   packSize,packCost,sheetCost,inkCost:0,status:values.status||'',source:values.source||'',note:values.note||''}
 }
 if(!item.id||!item.name||(editing.kind==='sku'&&!item.category))throw Error('Заполните обязательные поля');
 if(collection.some((x,i)=>x.id===item.id&&i!==index))throw Error('Такой код уже существует');
 if(index>=0)collection[index]=item;else collection.push(item);
 save();$('edit-dialog').close();renderCategories();renderSKU();renderCatalog();renderMaterials();notify('Сохранено локально · Google Таблица не изменена')
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
 const s=sku(),r=calc(s,count($('quantity').value),nonneg($('discount').value),0,nonneg($('extras').value),s.id==='DS-CUSTOM'?number($('custom-price').value):null);
 const txt='КАДР / '+s.name+' × '+$('quantity').value+'\nЦена: '+money(r.price)+'\nВыручка: '+money(r.revenue)+'\nМатериалы: '+money(r.cost)+'\nТруд: не учитывается'+'\nПрочие: '+money(nonneg($('extras').value))+'\nПрибыль: '+money(r.profit)+'\nМаржа: '+pct(r.margin);
 try{await navigator.clipboard.writeText(txt);notify('Расчёт скопирован')}catch{notify('Копирование недоступно')}
 });
 $('sku-search').addEventListener('input',renderCatalog);$('catalog-category').addEventListener('change',renderCatalog);
 $('add-sku').addEventListener('click',()=>openDialog('sku'));$('add-material').addEventListener('click',()=>openDialog('material'));
 $('sku-table').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.edit)openDialog('sku',b.dataset.edit);if(b.dataset.remove)remove('sku',b.dataset.remove)});
 $('materials-list').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.medit)openDialog('material',b.dataset.medit);if(b.dataset.mremove)remove('material',b.dataset.mremove);if(b.dataset.pedit)openDialog('ink',b.dataset.pedit)});
 $('dialog-fields').addEventListener('click',e=>{
   if(e.target.closest('#add-tier')){addTierRow();return}
   const removeButton=e.target.closest('.tier-remove');
   if(removeButton){
     const rows=$('tier-rows').querySelectorAll('.tier-row');
     if(rows.length<=1){notify('Нужен хотя бы один тариф');return}
     removeButton.closest('.tier-row').remove();updateTierRemoveButtons();
   }
 });
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
 if(stored?.version===4&&stored.sourceRevision===defaults.sourceRevision){
  state=valid(stored);
 }else{
  if(stored){
   await db.put(structuredClone(stored),'before-sheet-sync-'+defaults.sourceRevision);
   if(stored.version===3)await db.put(structuredClone(stored),'legacy-v3');
  }
  state=structuredClone(defaults);
  await db.put(state);
 }
 events();renderCategories();renderSKU();renderCatalog();renderMaterials();
 for(const version of [1,2,3]){
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
