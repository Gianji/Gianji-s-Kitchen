/* Mise — personal, browser-local recipe collection. No network storage. */
(() => {
  'use strict';

  const DB_NAME = 'mise-recipes';
  const DB_STORE = 'recipes';
  const CATEGORIES = ['Primi', 'Secondi', 'Antipasti', 'Contorni', 'Dolci', 'Colazione', 'Pane e lievitati', 'Salse e condimenti', 'Bevande', 'Altro'];
  const UNITS = ['', 'g', 'kg', 'ml', 'l', 'cucchiaio', 'cucchiaino', 'pz', 'spicchio', 'fetta', 'tazza', 'q.b.'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const attr = escapeHTML;
  const safePhoto = value => typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
  const id = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const minutes = recipe => (Number(recipe.prep) || 0) + (Number(recipe.cook) || 0);
  const duration = n => !n ? 'Tempo libero' : n >= 60 ? `${Math.floor(n/60)} h${n%60 ? ` ${n%60} min` : ''}` : `${n} min`;
  const formatNumber = number => Number.isInteger(number) ? String(number) : Number(number.toFixed(2)).toLocaleString('it-IT',{maximumFractionDigits:2});
  const state = {recipes:[],view:'all',category:'Tutte',query:'',sort:'newest',editingId:null,photo:'',detailId:null,servings:2,checked:new Set()};
  let database = null;
  let fallback = false;
  let toastTimer;

  const store = {
    async open() {
      if (!('indexedDB' in window)) { fallback = true; return; }
      try {
        database = await new Promise((resolve,reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE,{keyPath:'id'}); };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('Archivio temporaneamente occupato'));
        });
      } catch (e) { console.warn('IndexedDB unavailable:', e); fallback = true; }
    },
    transaction(mode, action) {
      return new Promise((resolve,reject) => {
        const tx = database.transaction(DB_STORE, mode);
        const request = action(tx.objectStore(DB_STORE));
        let result;
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || request.error);
        tx.onabort = () => reject(tx.error || new Error('Operazione interrotta'));
      });
    },
    async all() {
      if (fallback) { try { return JSON.parse(localStorage.getItem('mise-recipes-v1') || '[]'); } catch { return []; } }
      return this.transaction('readonly', os => os.getAll());
    },
    async put(recipe) {
      if (fallback) { const records = await this.all(); const i = records.findIndex(r => r.id === recipe.id); if (i >= 0) records[i] = recipe; else records.push(recipe); localStorage.setItem('mise-recipes-v1',JSON.stringify(records)); return; }
      await this.transaction('readwrite', os => os.put(recipe));
    },
    async remove(recipeId) {
      if (fallback) { localStorage.setItem('mise-recipes-v1',JSON.stringify((await this.all()).filter(r => r.id !== recipeId))); return; }
      await this.transaction('readwrite', os => os.delete(recipeId));
    },
    async import(records) {
      if (fallback) { const map = new Map((await this.all()).map(r => [r.id,r])); records.forEach(r => map.set(r.id,r)); localStorage.setItem('mise-recipes-v1',JSON.stringify([...map.values()])); return; }
      await new Promise((resolve,reject) => {
        const tx = database.transaction(DB_STORE,'readwrite');
        const os = tx.objectStore(DB_STORE);
        records.forEach(r => os.put(r));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
  };

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  }
  function openDialog(selector) { $(selector).showModal(); document.body.classList.add('dialog-open'); }
  function closeDialog(dialog) { if (dialog?.open) dialog.close(); document.body.classList.remove('dialog-open'); }
  function getRecipe(recipeId) { return state.recipes.find(r => r.id === recipeId); }
  function normalized(value) { return String(value || '').toLocaleLowerCase('it-IT').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

  function displayRecipes() {
    let records = state.recipes.filter(r => state.view !== 'favorites' || r.favorite);
    if (state.category !== 'Tutte') records = records.filter(r => r.category === state.category);
    const query = normalized(state.query.trim());
    if (query) records = records.filter(r => normalized([r.title,r.description,r.category,r.notes,...(r.tags || []),...(r.ingredients || []).map(i=>i.name)].join(' ')).includes(query));
    return [...records].sort((a,b) => {
      if (state.sort === 'name') return a.title.localeCompare(b.title,'it');
      if (state.sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (state.sort === 'time') return minutes(a)-minutes(b);
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });
  }
  function setView(view) {
    state.view = view; state.category = 'Tutte';
    $$('[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
    $('#topbar-section').textContent = view === 'favorites' ? 'PREFERITE' : 'TUTTE LE RICETTE';
    $('#collection-title').childNodes[0].textContent = view === 'favorites' ? 'Le preferite ' : 'Le mie ricette ';
    render();
    if (window.innerWidth < 800) $('.collection').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function render() {
    const recipes = displayRecipes();
    const favorites = state.recipes.filter(r => r.favorite).length;
    $('#nav-all-count').textContent = state.recipes.length;
    $('#nav-fav-count').textContent = favorites;
    $('#recipe-count').textContent = String(recipes.length).padStart(2,'0');
    const available = state.recipes.filter(r => state.view !== 'favorites' || r.favorite);
    const categories = ['Tutte',...CATEGORIES.filter(cat => available.some(r => r.category === cat))];
    if (!categories.includes(state.category)) state.category = 'Tutte';
    $('#category-filters').innerHTML = categories.map(cat => `<button class="filter-chip ${state.category === cat ? 'active':''}" data-category="${attr(cat)}">${escapeHTML(cat)}${cat === 'Tutte' ? ` · ${available.length}`:''}</button>`).join('');
    $('#recipe-grid').innerHTML = recipes.map(recipeCard).join('');
    const isEmpty = recipes.length === 0;
    $('#empty-state').hidden = !isEmpty;
    if (isEmpty) {
      const allEmpty = state.recipes.length === 0;
      const noFavorites = state.view === 'favorites' && !state.query && !favorites;
      $('#empty-kicker').textContent = allEmpty ? 'UNA PAGINA BIANCA, MILLE IDEE' : noFavorites ? 'LE COSE BELLE VANNO TENUTE STRETTE' : 'NESSUN RISULTATO';
      $('#empty-title').innerHTML = allEmpty ? 'La tua storia in cucina<br><em>inizia qui.</em>' : noFavorites ? 'Ancora nessuna<br><em>preferita.</em>' : 'Nessuna ricetta<br><em>trovata.</em>';
      $('#empty-description').textContent = allEmpty ? 'Aggiungi la prima ricetta. Bastano un nome, qualche ingrediente e un pizzico di voglia di cucinare.' : noFavorites ? 'Tocca il cuore su una ricetta per ritrovarla subito qui.' : 'Prova a cambiare le parole cercate o a scegliere un’altra categoria.';
      $('#empty-add').innerHTML = `${icon('plus')} ${allEmpty ? 'Scrivi la prima ricetta':'Aggiungi una ricetta'} ${icon('arrow')}`;
    }
  }
  function recipeCard(recipe) {
    const photo = safePhoto(recipe.photo);
    const cover = photo ? `<img src="${attr(photo)}" alt="Foto di ${attr(recipe.title)}" loading="lazy">` : `<div class="card-image-fallback"><span>m.</span></div>`;
    const total = minutes(recipe);
    return `<article class="recipe-card" data-open="${attr(recipe.id)}" tabindex="0" role="button" aria-label="Apri ${attr(recipe.title)}">
      <div class="card-image">${cover}<button class="card-favorite ${recipe.favorite?'active':''}" data-favorite="${attr(recipe.id)}" aria-label="${recipe.favorite?'Rimuovi dai preferiti':'Aggiungi ai preferiti'}" aria-pressed="${!!recipe.favorite}">${icon('heart')}</button></div>
      <div class="card-body"><div class="card-category">${escapeHTML(recipe.category || 'Altro')}</div><h3 class="card-title">${escapeHTML(recipe.title)}</h3><p class="card-description">${escapeHTML(recipe.description || 'Una ricetta da conservare, preparare e assaporare.')}</p><div class="card-meta"><span>${icon('clock')} ${duration(total)}</span><span>${icon('users')} ${Number(recipe.servings)||2} porzioni</span></div></div>
    </article>`;
  }

  function ingredientRow(ingredient={}) {
    return `<div class="ingredient-row"><input class="row-control ingredient-qty" aria-label="Quantità" placeholder="Qtà" value="${attr(ingredient.qty || '')}" inputmode="decimal"><select class="row-control ingredient-unit" aria-label="Unità di misura">${[...new Set([...UNITS,ingredient.unit||''])].map(unit => `<option value="${attr(unit)}" ${unit===ingredient.unit?'selected':''}>${escapeHTML(unit || '—')}</option>`).join('')}</select><input class="row-control ingredient-name" aria-label="Nome ingrediente" placeholder="Ingrediente" value="${attr(ingredient.name||'')}" maxlength="200"><button type="button" class="row-remove" data-remove-row aria-label="Rimuovi ingrediente">${icon('close')}</button></div>`;
  }
  function stepRow(text='') {
    return `<div class="step-row"><span class="row-index">1</span><textarea class="row-control step-textarea" aria-label="Passaggio" rows="2" placeholder="Descrivi questo passaggio..." maxlength="5000">${escapeHTML(text)}</textarea><button type="button" class="row-remove" data-remove-row aria-label="Rimuovi passaggio">${icon('close')}</button></div>`;
  }
  function renumberSteps() { $$('.step-row .row-index').forEach((el,index) => { el.textContent = String(index+1).padStart(2,'0'); }); }
  function setPhoto(data) {
    state.photo = safePhoto(data);
    $('#photo-preview').innerHTML = state.photo ? `<img src="${attr(state.photo)}" alt="Anteprima foto ricetta">` : `<div class="photo-placeholder">${icon('image')}<span>Una foto rende tutto più buono</span><small>JPG, PNG o WebP · fino a 12 MB</small></div>`;
    $('#remove-photo').hidden = !state.photo;
    $('#recipe-photo').value = '';
  }
  function openEditor(recipe=null) {
    state.editingId = recipe?.id || null;
    $('#recipe-form').reset();
    $('#editor-title').innerHTML = recipe ? 'Modifica <em>ricetta.</em>' : 'Nuova <em>ricetta.</em>';
    $('#save-recipe').innerHTML = `${recipe ? 'Salva modifiche':'Salva ricetta'} ${icon('arrow')}`;
    const data = recipe || {};
    $('#recipe-title').value = data.title || '';
    $('#recipe-description').value = data.description || '';
    $('#recipe-category').value = CATEGORIES.includes(data.category) ? data.category : 'Primi';
    $('#recipe-difficulty').value = data.difficulty || 'Facile';
    $('#recipe-prep').value = data.prep || '';
    $('#recipe-cook').value = data.cook || '';
    $('#recipe-servings').value = data.servings || 2;
    $('#recipe-tags').value = (data.tags || []).join(', ');
    $('#recipe-notes').value = data.notes || '';
    $('#recipe-favorite').checked = !!data.favorite;
    $('#ingredient-rows').innerHTML = (data.ingredients?.length ? data.ingredients : [{},{},{}]).map(ingredientRow).join('');
    $('#step-rows').innerHTML = (data.steps?.length ? data.steps : ['']).map(stepRow).join('');
    renumberSteps(); setPhoto(data.photo || '');
    openDialog('#editor-dialog');
    setTimeout(() => $('#recipe-title').focus({preventScroll:true}),120);
  }
  async function imageToDataURL(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Scegli una foto JPG, PNG o WebP.');
    if (file.size > 12 * 1024 * 1024) throw new Error('La foto deve essere più piccola di 12 MB.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve,reject) => { image.onload=resolve; image.onerror=()=>reject(new Error('Impossibile leggere la foto.')); image.src=objectUrl; });
      const scale = Math.min(1,1400 / Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx = canvas.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',.83);
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  function readIngredientRows() {
    return $$('.ingredient-row').map(row=>({qty:$('.ingredient-qty',row).value.trim(),unit:$('.ingredient-unit',row).value,name:$('.ingredient-name',row).value.trim()})).filter(r => r.name);
  }
  async function saveRecipe(event) {
    event.preventDefault();
    const title=$('#recipe-title').value.trim();
    if (!title) { $('#recipe-title').focus(); return; }
    const old = state.editingId ? getRecipe(state.editingId) : null;
    const now = new Date().toISOString();
    const recipe = {
      id:old?.id || id(),createdAt:old?.createdAt || now,updatedAt:now,
      title,description:$('#recipe-description').value.trim(),category:$('#recipe-category').value,
      difficulty:$('#recipe-difficulty').value,prep:Math.max(0,Number($('#recipe-prep').value)||0),cook:Math.max(0,Number($('#recipe-cook').value)||0),
      servings:Math.max(1,Number($('#recipe-servings').value)||2),
      ingredients:readIngredientRows(),steps:$$('.step-textarea').map(el=>el.value.trim()).filter(Boolean),
      tags:[...new Set($('#recipe-tags').value.split(',').map(t=>t.trim()).filter(Boolean))],notes:$('#recipe-notes').value.trim(),favorite:$('#recipe-favorite').checked,photo:state.photo
    };
    const button=$('#save-recipe');button.disabled=true;
    try { await store.put(recipe); closeDialog($('#editor-dialog')); await refresh(); toast(old ? 'Ricetta aggiornata con successo':'Ricetta salvata nel tuo ricettario'); }
    catch(e){ console.error(e);toast('Salvataggio non riuscito. Prova a esportare un backup o liberare spazio sul dispositivo.'); }
    finally{button.disabled=false;}
  }
  async function refresh(){state.recipes=await store.all();render();}
  async function toggleFavorite(recipeId){
    const recipe=getRecipe(recipeId);if(!recipe)return;
    try{await store.put({...recipe,favorite:!recipe.favorite,updatedAt:new Date().toISOString()});await refresh();if(state.detailId===recipeId&&$('#detail-dialog').open)renderDetail();}
    catch(e){console.error(e);toast('Impossibile aggiornare i preferiti');}
  }
  function scaledQuantity(qty,ratio){
    const raw=String(qty||'').trim(); if(!raw)return '';
    const fraction=raw.match(/^(\d+)?\s*(\d+)\/(\d+)$/);
    let n;
    if(fraction)n=Number(fraction[1]||0)+Number(fraction[2])/Number(fraction[3]);
    else if (/^\d+(?:[.,]\d+)?$/.test(raw)) n=Number(raw.replace(',','.'));
    if(!Number.isFinite(n))return raw;
    return formatNumber(n*ratio);
  }
  function renderDetail(){
    const recipe=getRecipe(state.detailId);if(!recipe){closeDialog($('#detail-dialog'));return;}
    const ratio=state.servings/(Number(recipe.servings)||2);
    const photo=safePhoto(recipe.photo);
    const ingredients=(recipe.ingredients||[]).map((ingredient,index)=>{
      const amount=[scaledQuantity(ingredient.qty,ratio),ingredient.unit].filter(Boolean).join(' ');
      return `<li class="${state.checked.has(index)?'checked':''}"><input type="checkbox" data-check-ingredient="${index}" aria-label="Spunta ${attr(ingredient.name)}" ${state.checked.has(index)?'checked':''}><span>${amount?`<strong>${escapeHTML(amount)}</strong> · `:''}${escapeHTML(ingredient.name)}</span></li>`;
    }).join('') || '<li><span>Non hai ancora inserito ingredienti.</span></li>';
    const steps=(recipe.steps||[]).map((step,index)=>`<li><span class="step-num">${String(index+1).padStart(2,'0')}</span><span class="step-copy">${escapeHTML(step)}</span></li>`).join('') || '<li><span class="step-copy">Nessun passaggio inserito.</span></li>';
    $('#detail-content').innerHTML=`<div class="detail-top"><div class="detail-cover">${photo?`<img src="${attr(photo)}" alt="${attr(recipe.title)}">`:'<span>m.</span>'}</div><div class="detail-intro"><div class="detail-category">${escapeHTML(recipe.category||'Altro')} · ${escapeHTML(recipe.difficulty||'Facile')}</div><h2 id="detail-title">${escapeHTML(recipe.title)}</h2><p>${escapeHTML(recipe.description||'Una ricetta del tuo ricettario personale.')}</p><div class="detail-meta"><span>${icon('clock')} ${duration(minutes(recipe))}</span><span>${icon('users')} ${Number(recipe.servings)||2} porzioni</span></div></div><button class="icon-button detail-close" data-detail-action="close" aria-label="Chiudi">${icon('close')}</button></div>
    <div class="detail-toolbar"><button class="detail-fav ${recipe.favorite?'active':''}" data-detail-action="favorite">${icon('heart')} <span>${recipe.favorite?'Preferita':'Preferiti'}</span></button><button data-detail-action="edit">${icon('edit')} Modifica</button><button data-detail-action="print">${icon('print')} Stampa</button><span class="detail-spacer"></span><button class="danger" data-detail-action="delete">${icon('trash')} Elimina</button></div>
    <div class="detail-body"><section><h3>Ingredienti</h3><div class="servings-control"><span>Adatta le quantità</span><div class="servings-stepper"><button data-servings="-1" aria-label="Diminuisci porzioni">−</button><strong>${state.servings}</strong><button data-servings="1" aria-label="Aumenta porzioni">+</button></div></div><ul class="ingredients-list">${ingredients}</ul></section><section><h3>Preparazione</h3><ol class="steps-list">${steps}</ol>${recipe.notes?`<div class="detail-notes"><h4>Un piccolo appunto</h4><p>${escapeHTML(recipe.notes)}</p></div>`:''}${recipe.tags?.length?`<div class="detail-tags">${recipe.tags.map(tag=>`<span class="detail-tag"># ${escapeHTML(tag)}</span>`).join('')}</div>`:''}</section></div>`;
  }
  function openDetail(recipeId){
    const recipe=getRecipe(recipeId);if(!recipe)return;
    state.detailId=recipeId;state.servings=Number(recipe.servings)||2;state.checked=new Set();renderDetail();openDialog('#detail-dialog');
  }
  async function deleteRecipe(){
    const recipe=getRecipe(state.detailId);if(!recipe)return;
    if(!window.confirm(`Vuoi eliminare “${recipe.title}”? L'operazione non può essere annullata.`))return;
    try{await store.remove(recipe.id);closeDialog($('#detail-dialog'));state.detailId=null;await refresh();toast('Ricetta eliminata');}
    catch(e){console.error(e);toast('Impossibile eliminare la ricetta');}
  }
  async function exportBackup(){
    try{
      const archive={application:'mise',version:1,exportedAt:new Date().toISOString(),recipes:await store.all()};
      const blob=new Blob([JSON.stringify(archive,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);const a=document.createElement('a');
      a.href=url;a.download=`mise-ricettario-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);
      toast(`Backup pronto: ${archive.recipes.length} ricette`);
    }catch(e){console.error(e);toast('Non è stato possibile esportare il ricettario');}
  }
  function validateImport(data){
    if(!data || data.application!=='mise' || data.version!==1 || !Array.isArray(data.recipes))throw new Error('Questo file non è un backup Mise valido.');
    if(data.recipes.length>2000)throw new Error('Il backup contiene troppe ricette.');
    return data.recipes.map(r=>{
      if(!r || typeof r.id!=='string'||r.id.length>150||typeof r.title!=='string'||!r.title.trim())throw new Error('Il backup contiene una ricetta non valida.');
      return {id:r.id,title:r.title.slice(0,130),description:String(r.description||'').slice(0,1000),category:CATEGORIES.includes(r.category)?r.category:'Altro',difficulty:['Facile','Media','Impegnativa'].includes(r.difficulty)?r.difficulty:'Facile',prep:Math.max(0,Number(r.prep)||0),cook:Math.max(0,Number(r.cook)||0),servings:Math.max(1,Number(r.servings)||2),ingredients:Array.isArray(r.ingredients)?r.ingredients.slice(0,200).map(i=>({qty:String(i.qty||'').slice(0,50),unit:String(i.unit||'').slice(0,40),name:String(i.name||'').slice(0,200)})):[],steps:Array.isArray(r.steps)?r.steps.slice(0,100).map(s=>String(s).slice(0,5000)):[],tags:Array.isArray(r.tags)?r.tags.slice(0,80).map(t=>String(t).slice(0,60)):[],notes:String(r.notes||'').slice(0,20000),photo:safePhoto(r.photo),favorite:!!r.favorite,createdAt:r.createdAt||new Date().toISOString(),updatedAt:r.updatedAt||new Date().toISOString()};
    });
  }
  async function importBackup(file){
    if(!file)return;
    if(file.size>90*1024*1024){toast('Il file è troppo grande (massimo 90 MB).');return;}
    try{
      const data=JSON.parse(await file.text());const records=validateImport(data);
      if(!records.length){toast('Il backup non contiene ricette');return;}
      if(!window.confirm(`Importare ${records.length} ricette? Quelle con lo stesso identificativo saranno aggiornate; le altre rimarranno.`))return;
      await store.import(records);await refresh();closeDialog($('#settings-dialog'));toast(`${records.length} ricette importate con successo`);
    }catch(e){console.error(e);toast(e instanceof SyntaxError?'Il file JSON non è leggibile':e.message||'Importazione non riuscita');}
    finally{$('#backup-file').value='';}
  }

  function wireEvents(){
    $$('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
    $('#logo-link').addEventListener('click',event=>{event.preventDefault();setView('all');window.scrollTo({top:0,behavior:'smooth'});});
    ['hero-add','collection-add','empty-add','mobile-add'].forEach(name=>$('#'+name).addEventListener('click',()=>openEditor()));
    ['open-settings','open-settings-mobile'].forEach(name=>$('#'+name).addEventListener('click',()=>openDialog('#settings-dialog')));
    $('#search-input').addEventListener('input',event=>{state.query=event.target.value;render();});
    $('#sort-select').addEventListener('change',event=>{state.sort=event.target.value;render();});
    $('#category-filters').addEventListener('click',event=>{const chip=event.target.closest('[data-category]');if(chip){state.category=chip.dataset.category;render();}});
    $('#recipe-grid').addEventListener('click',async event=>{
      const favorite=event.target.closest('[data-favorite]');if(favorite){event.stopPropagation();await toggleFavorite(favorite.dataset.favorite);return;}
      const card=event.target.closest('[data-open]');if(card)openDetail(card.dataset.open);
    });
    $('#recipe-grid').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.recipe-card')){event.preventDefault();openDetail(event.target.dataset.open);}});
    $$('[data-close]').forEach(button=>button.addEventListener('click',()=>closeDialog($('#'+button.dataset.close))));
    $$('dialog').forEach(dialog=>{
      dialog.addEventListener('click',event=>{if(event.target===dialog)closeDialog(dialog);});
      dialog.addEventListener('close',()=>document.body.classList.remove('dialog-open'));
    });
    $('#add-ingredient').addEventListener('click',()=>{ $('#ingredient-rows').insertAdjacentHTML('beforeend',ingredientRow());$$('.ingredient-name').at(-1)?.focus(); });
    $('#add-step').addEventListener('click',()=>{$('#step-rows').insertAdjacentHTML('beforeend',stepRow());renumberSteps();$$('.step-textarea').at(-1)?.focus();});
    $('#recipe-form').addEventListener('click',event=>{const button=event.target.closest('[data-remove-row]');if(button){button.parentElement.remove();renumberSteps();}});
    $('#recipe-form').addEventListener('submit',saveRecipe);
    $('#recipe-photo').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{setPhoto(await imageToDataURL(file));}catch(e){toast(e.message);}});
    $('#remove-photo').addEventListener('click',()=>setPhoto(''));
    $('#detail-content').addEventListener('click',async event=>{
      const servingButton=event.target.closest('[data-servings]');if(servingButton){state.servings=Math.min(1000,Math.max(1,state.servings+Number(servingButton.dataset.servings)));renderDetail();return;}
      const action=event.target.closest('[data-detail-action]')?.dataset.detailAction;
      if(action==='close')closeDialog($('#detail-dialog'));
      if(action==='favorite')await toggleFavorite(state.detailId);
      if(action==='edit'){const recipe=getRecipe(state.detailId);closeDialog($('#detail-dialog'));openEditor(recipe);}
      if(action==='print')window.print();
      if(action==='delete')await deleteRecipe();
    });
    $('#detail-content').addEventListener('change',event=>{const checkbox=event.target.closest('[data-check-ingredient]');if(!checkbox)return;const index=Number(checkbox.dataset.checkIngredient);if(checkbox.checked)state.checked.add(index);else state.checked.delete(index);checkbox.closest('li').classList.toggle('checked',checkbox.checked);});
    $('#export-data').addEventListener('click',exportBackup);
    $('#import-data').addEventListener('click',()=>$('#backup-file').click());
    $('#backup-file').addEventListener('change',event=>importBackup(event.target.files?.[0]));
  }
  async function init(){
    $('#today-date').textContent=new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'long',year:'numeric'}).format(new Date());
    wireEvents();await store.open();
    if(fallback)toast('Modalità di compatibilità: lo spazio per le foto può essere limitato.');
    try{await refresh();}catch(e){console.error(e);toast('Impossibile leggere il ricettario locale.');}
  }
  init();
})();
