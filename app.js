const $ = (id) => document.getElementById(id);
const money = (n) => Number.isFinite(n) ? n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₾' : '—';
const percent = (n) => Number.isFinite(n) ? n.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+'%' : '—';
const numeric = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const positive = (v) => Math.max(0, numeric(v));
const integer = (v) => Math.max(1, Math.floor(numeric(v)||1));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'kadr-price-ops-v1';
let state, backupSeed, selectedSku = 'POL-8', currentPage = 'calculator', editState=null;
const DIALOG_FIELDS = {
  sku:[
    ['id','SKU (уникальный код)','text',true],['category','Категория','text',true],['name','Название позиции','text',true],
    ['unit','Единица: штука / набор','text',true],['units','Изделий в одном SKU','number',true],
    ['price','Розничная цена за SKU, ₾','decimal',true],['material','Материал','material',true],
    ['yield','Изделий с одного листа','number',true],['min','Мин. число SKU в заказе','number',false],
    ['max','Макс. число SKU (0 = без ограничения)','number',false],['note','Комментарий','text',false]
  ],
  material:[['id','Код материала (уникальный)','text',true],['name','Название','text',true],['sheetCost','Цена одного листа, ₾','decimal',true],['inkCost','Чернила на лист, ₾','decimal',true],['note','Комментарий','text',false]]
};

function validateData(input){
  if(!input || !Array.isArray(input.skus) || !Array.isArray(input.materials)) throw new Error('Неподходящий формат резервной копии');
  if(input.skus.length>10000 || input.materials.length>1000) throw new Error('Слишком много записей');
  const materials=input.materials.map(m=>{
    if(!m || !m.id || !m.name || numeric(m.sheetCost)<0 || numeric(m.inkCost)<0) throw new Error('Неверные данные материала');
    return {id:String(m.id),name:String(m.name),sheetCost:positive(m.sheetCost),inkCost:positive(m.inkCost),note:String(m.note||'')};
  });
  const ids=new Set();
  const skus=input.skus.map(s=>{
    if(!s || !s.id || !s.name || !s.category || !Number.isFinite(Number(s.price)) || numeric(s.price)<0 || numeric(s.units)<1 || numeric(s.yield)<1) throw new Error('Неверная позиция SKU');
    if(ids.has(s.id)) throw new Error('Повторяется код SKU: '+s.id);
    ids.add(s.id);
    return {id:String(s.id),name:String(s.name),category:String(s.category),unit:String(s.unit||'набор'),units:integer(s.units),price:positive(s.price),material:String(s.material||'NONE'),yield:integer(s.yield),min:Math.max(0,Math.floor(numeric(s.min))),max:Math.max(0,Math.floor(numeric(s.max))),note:String(s.note||'')};
  });
  return {version:1,skus,materials};
}
const store = {
  async open(){return new Promise((resolve,reject)=>{const req=indexedDB.open(KEY,1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})},
  async read(){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly');const req=tx.objectStore('state').get('data');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})},
  async write(data){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(data,'data');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
};
let saving=Promise.resolve();
function save(){saving=saving.then(()=>store.write(state));saving.catch(e=>toast('Ошибка сохранения: '+e.message));}
function toast(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3000)}
function findSku(){return state.skus.find(s=>s.id===selectedSku)}
function materialFor(s){return state.materials.find(m=>m.id===s.material)}
function calculateMaterial(s,quantity){
  if(!s || s.material==='NONE' || !s.material) return {cost:0,sheets:0,missing:false};
  const m=materialFor(s);
  if(!m) return {cost:NaN,sheets:0,missing:true};
  const sheets=Math.ceil(s.units*quantity/s.yield);
  return {cost:sheets*(m.sheetCost+m.inkCost),sheets,missing:false};
}
function calc(s,q,discount,labor,extras){
  const units=s.units*q, revenue=s.price*q-discount, material=calculateMaterial(s,q);
  const costs=material.cost+labor+extras;
  return {...material,units,revenue,costs,profit:revenue-costs,margin:revenue>0 ? (revenue-costs)/revenue*100:NaN};
}
function page(p){
  currentPage=p;
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===p));
  document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.page===p));
  const labels={calculator:['Калькулятор','Быстрый расчёт заказа и маржи.'],catalog:['Каталог SKU','Весь прайс и редактирование позиций.'],materials:['Материалы','Бумага, чернила и расходы на печать.'],settings:['Данные','Резервные копии и методика расчётов.']};
  $('page-title').textContent=labels[p][0];$('page-subtitle').textContent=labels[p][1];
  if(p==='catalog') renderCatalog();
  if(p==='materials') renderMaterials();
}
function categories(){return [...new Set(state.skus.map(s=>s.category))].sort((a,b)=>a.localeCompare(b,'ru'))}
function renderCategories(){
  const before=$('category-filter').value;
  $('category-filter').innerHTML='<option value="">Все категории</option>'+categories().map(c=>'<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>').join('');
  if(categories().includes(before)) $('category-filter').value=before;
  const beforeCatalog=$('catalog-category').value;
  $('catalog-category').innerHTML='<option value="">Все категории</option>'+categories().map(c=>'<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>').join('');
  if(categories().includes(beforeCatalog)) $('catalog-category').value=beforeCatalog;
}
function renderSkuSelect(){
  const filter=$('category-filter').value;
  const list=state.skus.filter(s=>!filter || s.category===filter);
  $('sku-select').innerHTML=list.map(s=>'<option value="'+escapeHtml(s.id)+'">'+escapeHtml(s.name)+' / '+money(s.price)+'</option>').join('');
  if(list.some(s=>s.id===selectedSku)) $('sku-select').value=selectedSku;
  else{selectedSku=list[0]?.id || '';$('sku-select').value=selectedSku}
  updateCalculator();
}
function updateCalculator(){
  const s=findSku();
  if(!s){$('sku-description').textContent='Добавьте SKU в каталоге';return}
  const q=integer($('quantity').value), discount=positive($('discount').value),labor=positive($('labor').value),extras=positive($('extras').value);
  const result=calc(s,q,discount,labor,extras), missing=result.missing;
  $('sku-description').textContent=s.id+' • '+s.units+' изд. / SKU • '+s.note;
  $('revenue-value').textContent=money(result.revenue);
  $('profit-value').textContent=missing?'—':money(result.profit);
  $('profit-value').classList.toggle('negative',!missing && result.profit<0);
  $('margin-value').textContent=missing?'—':percent(result.margin);
  $('materials-value').textContent=money(result.cost);
  $('cost-value').textContent=missing?'—':money(result.costs);
  $('units-value').textContent=String(result.units);
  $('sheets-value').textContent=missing?'—':String(result.sheets);
  $('unit-price-value').textContent=money(s.price);
  $('overhead-value').textContent=money(labor+extras);
  $('discount-value').textContent=money(discount);
  $('profit-status').textContent=missing?'Не найден материал':result.revenue<=0?'Проверьте скидку':result.profit<0?'Убыточный заказ':result.margin<20?'Низкая маржа':'Положительная маржа';
  const warnings=[];
  if(missing) warnings.push('У SKU не найден материал: '+s.material);
  if(result.revenue<=0) warnings.push('Скидка не может обнулить или превысить стоимость заказа.');
  if(s.min && q<s.min) warnings.push('Для этого тарифа минимальный объём: '+s.min+' SKU.');
  if(s.max && q>s.max) warnings.push('Для этого тарифа максимальный объём: '+s.max+' SKU.');
  if(labor===0) warnings.push('Работа указана как 0 ₾: результат не учитывает труд.');
  $('calc-warning').hidden=!warnings.length;$('calc-warning').textContent=warnings.join(' ');
}
function renderCatalog(){
  const search=$('sku-search').value.trim().toLowerCase(), category=$('catalog-category').value;
  const list=state.skus.filter(s=>(!category||s.category===category)&&(!search||(s.id+' '+s.name+' '+s.category).toLowerCase().includes(search)));
  $('sku-table').innerHTML=list.map(s=>{
    const m=calculateMaterial(s,1),margin=s.price-m.cost;
    return '<tr><td>'+escapeHtml(s.name)+'<small>'+escapeHtml(s.id)+' · '+escapeHtml(s.category)+' · '+s.units+' изд.</small></td><td class="price">'+money(s.price)+'</td><td class="material-cost">'+money(m.cost)+'</td><td class="gross">'+money(margin)+'</td><td><div class="actions"><button class="tiny" data-edit="'+escapeHtml(s.id)+'">Изменить</button><button class="tiny remove" data-remove="'+escapeHtml(s.id)+'">×</button></div></td></tr>';
  }).join('')||'<tr><td colspan="5" class="muted">Позиции не найдены</td></tr>';
}
function renderMaterials(){
  $('materials-list').innerHTML=state.materials.map(m=>'<div class="material-item"><div><strong>'+escapeHtml(m.name)+'</strong><small>'+escapeHtml(m.id)+' · '+escapeHtml(m.note)+'</small></div><div class="material-values"><b>'+money(m.sheetCost+m.inkCost)+'/лист</b><button class="tiny" data-medit="'+escapeHtml(m.id)+'">Изменить</button><button class="tiny remove" data-mremove="'+escapeHtml(m.id)+'">×</button></div></div>').join('')||'<p class="muted">Материалов пока нет</p>';
}
function dialog(kind,id){
  editState={kind,id};
  const existing=kind==='sku'?state.skus.find(s=>s.id===id):state.materials.find(m=>m.id===id);
  $('dialog-title').textContent=(existing?'Изменить ':'Добавить ')+(kind==='sku'?'SKU':'материал');
  $('dialog-fields').innerHTML=DIALOG_FIELDS[kind].map(([key,label,type,required])=>{
    const val=existing?.[key]??(type==='number'?1:type==='decimal'?0:'');
    let input;
    if(type==='material')input='<select class="dialog-input" name="'+key+'"><option value="NONE">Без материальных затрат</option>'+state.materials.map(m=>'<option value="'+escapeHtml(m.id)+'" '+(val===m.id?'selected':'')+'>'+escapeHtml(m.name)+'</option>').join('')+'</select>';
    else input='<input class="dialog-input" name="'+key+'" value="'+escapeHtml(val)+'" type="'+(type==='number'||type==='decimal'?'number':'text')+'" '+(type==='number'?'min="1" step="1"':type==='decimal'?'min="0" step="0.01"':'')+' '+(required?'required':'')+' '+(key==='id'&&existing?'readonly':'')+' maxlength="500" />';
    return '<label class="dialog-field"><span>'+escapeHtml(label)+'</span>'+input+'</label>';
  }).join('');
  $('edit-dialog').showModal();
}
function saveDialog(e){
  e.preventDefault();
  if(!$('edit-form').reportValidity()) return;
  const {kind,id}=editState, form=new FormData($('edit-form'));
  const obj=Object.fromEntries(form.entries());
  const collection=kind==='sku'?state.skus:state.materials;
  const index=collection.findIndex(x=>x.id===id);
  if(kind==='sku'){
    obj.id=obj.id.trim();obj.category=obj.category.trim();obj.name=obj.name.trim();
    obj.price=positive(obj.price);obj.units=integer(obj.units);obj.yield=integer(obj.yield);
    obj.min=Math.max(0,Math.floor(numeric(obj.min)));obj.max=Math.max(0,Math.floor(numeric(obj.max)));
    if(!obj.id||!obj.name||!obj.category){toast('Заполните обязательные поля');return}
    if(obj.max && obj.min>obj.max){toast('Мин. количество больше максимума');return}
  }else{
    obj.id=obj.id.trim();obj.name=obj.name.trim();obj.sheetCost=positive(obj.sheetCost);obj.inkCost=positive(obj.inkCost);
  }
  if(collection.some((x,i)=>x.id===obj.id&&i!==index)){toast('Такой код уже существует');return}
  if(index>=0) collection[index]=obj;else collection.push(obj);
  save();$('edit-dialog').close();renderCategories();renderSkuSelect();renderCatalog();renderMaterials();toast('Сохранено');
}
function remove(kind,id){
  const collection=kind==='sku'?state.skus:state.materials;
  const obj=collection.find(x=>x.id===id);if(!obj)return;
  if(kind==='material'&&state.skus.some(s=>s.material===id)){toast('Материал используется в SKU. Сначала измените привязку.');return}
  if(!confirm('Удалить «'+obj.name+'»?'))return;
  state[kind==='sku'?'skus':'materials']=collection.filter(x=>x.id!==id);
  if(kind==='sku'&&selectedSku===id)selectedSku=state.skus[0]?.id||'';
  save();renderCategories();renderSkuSelect();renderCatalog();renderMaterials();toast('Удалено');
}
function exportData(){
  const payload=JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([payload],{type:'application/json'}));a.download='KADR_BACKUP_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Резервная копия сохранена');
}
async function importData(file){
  if(!file)return;
  if(file.size>5*1024*1024){toast('Файл больше 5 МБ');return}
  try{const data=validateData(JSON.parse(await file.text()));if(!confirm('Заменить текущий каталог и материалы данными из файла?'))return;state=data;await store.write(state);selectedSku=state.skus[0]?.id||'';renderCategories();renderSkuSelect();renderCatalog();renderMaterials();toast('Данные восстановлены');}
  catch(e){toast('Ошибка импорта: '+e.message)}
  finally{$('import-data').value=''}
}
function listeners(){
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>page(t.dataset.page)));
  $('category-filter').addEventListener('change',renderSkuSelect);
  $('sku-select').addEventListener('change',e=>{selectedSku=e.target.value;updateCalculator()});
  ['quantity','discount','labor','extras'].forEach(id=>$(id).addEventListener('input',updateCalculator));
  $('reset-calculator').addEventListener('click',()=>{['discount','labor','extras'].forEach(id=>$(id).value=0);$('quantity').value=1;updateCalculator()});
  $('copy-result').addEventListener('click',async()=>{const s=findSku();if(!s)return;const r=calc(s,integer($('quantity').value),positive($('discount').value),positive($('labor').value),positive($('extras').value));const output='КАДР / '+s.name+' × '+$('quantity').value+'\nВыручка: '+money(r.revenue)+'\nМатериалы: '+money(r.cost)+'\nРабота: '+money(positive($('labor').value))+'\nПрочие: '+money(positive($('extras').value))+'\nПрибыль: '+money(r.profit)+'\nМаржа: '+percent(r.margin);try{await navigator.clipboard.writeText(output);toast('Расчёт скопирован')}catch{toast('Не удалось скопировать')}});
  $('sku-search').addEventListener('input',renderCatalog);$('catalog-category').addEventListener('change',renderCatalog);
  $('add-sku').addEventListener('click',()=>dialog('sku'));$('add-material').addEventListener('click',()=>dialog('material'));
  $('sku-table').addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;if(btn.dataset.edit)dialog('sku',btn.dataset.edit);if(btn.dataset.remove)remove('sku',btn.dataset.remove)});
  $('materials-list').addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;if(btn.dataset.medit)dialog('material',btn.dataset.medit);if(btn.dataset.mremove)remove('material',btn.dataset.mremove)});
  $('edit-form').addEventListener('submit',saveDialog);$('close-dialog').addEventListener('click',()=>$('edit-dialog').close());$('cancel-dialog').addEventListener('click',()=>$('edit-dialog').close());
  $('export-data').addEventListener('click',exportData);$('import-data').addEventListener('change',e=>importData(e.target.files[0]));
  $('reset-all').addEventListener('click',async()=>{if(!confirm('Восстановить исходные 66 SKU и материалы? Все ваши изменения будут потеряны. Рекомендуем сначала скачать JSON.'))return;state=structuredClone(backupSeed);await store.write(state);selectedSku='POL-8';renderCategories();renderSkuSelect();renderCatalog();renderMaterials();toast('Исходный прайс восстановлен')});
}
async function init(){
  try{
    const seed=await fetch('./seed.json').then(r=>{if(!r.ok)throw Error('Не загрузился исходный прайс');return r.json()});
    backupSeed=validateData(seed);
    const stored=await store.read();
    state=stored?validateData(stored):structuredClone(backupSeed);
    if(!stored)await store.write(state);
    listeners();renderCategories();renderSkuSelect();renderCatalog();renderMaterials();updateCalculator();
  }catch(e){document.querySelector('main').innerHTML='<div class="panel"><h2>Не удалось открыть данные</h2><p>'+escapeHtml(e.message)+'</p><p>Проверьте доступность памяти браузера и перезагрузите страницу.</p></div>'}
}
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
init();
