/* Mise — personal, browser-local recipe collection. No network storage. */
(() => {
  'use strict';

  const DB_NAME = 'mise-recipes';
  const DB_STORE = 'recipes';
  const DB_SHOPPING = 'shopping';
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
  const state = {recipes:[],shopping:[],view:'all',category:'Tutte',query:'',sort:'newest',editingId:null,photo:'',detailId:null,servings:2,checked:new Set(),choices:new Map()};
  let database = null;
  let fallback = false;
  let toastTimer;

  const store = {
    async open() {
      if (!('indexedDB' in window)) { fallback = true; return; }
      try {
        database = await new Promise((resolve,reject) => {
          const req = indexedDB.open(DB_NAME, 2);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE,{keyPath:'id'});
            if (!req.result.objectStoreNames.contains(DB_SHOPPING)) req.result.createObjectStore(DB_SHOPPING,{keyPath:'id'});
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('Archivio temporaneamente occupato'));
        });
      } catch (e) { console.warn('IndexedDB unavailable:', e); fallback = true; }
    },
    transaction(mode, action, storeName=DB_STORE) {
      return new Promise((resolve,reject) => {
        const tx = database.transaction(storeName, mode);
        const request = action(tx.objectStore(storeName));
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
    },
    async replaceAll(recipes,shopping) {
      if (fallback) {
        const recipeKey='mise-recipes-v1',shoppingKey='mise-shopping-v1';
        const previousRecipes=localStorage.getItem(recipeKey),previousShopping=localStorage.getItem(shoppingKey);
        try {
          localStorage.setItem(recipeKey,JSON.stringify(recipes));
          localStorage.setItem(shoppingKey,JSON.stringify(shopping));
        } catch (error) {
          try {
            if(previousRecipes===null)localStorage.removeItem(recipeKey);else localStorage.setItem(recipeKey,previousRecipes);
            if(previousShopping===null)localStorage.removeItem(shoppingKey);else localStorage.setItem(shoppingKey,previousShopping);
          } catch (rollbackError) { console.error('Ripristino archivio locale non riuscito:',rollbackError); }
          throw error;
        }
        return;
      }
      await new Promise((resolve,reject)=>{
        // Entrambe le raccolte vengono sostituite nella stessa transazione: o tutte, o nessuna.
        const tx=database.transaction([DB_STORE,DB_SHOPPING],'readwrite');
        const recipeStore=tx.objectStore(DB_STORE),shoppingStore=tx.objectStore(DB_SHOPPING);
        recipeStore.clear();shoppingStore.clear();
        recipes.forEach(recipe=>recipeStore.put(recipe));
        shopping.forEach(item=>shoppingStore.put(item));
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('Ripristino non riuscito'));
        tx.onabort=()=>reject(tx.error||new Error('Ripristino interrotto'));
      });
    },
    async shoppingAll() {
      if (fallback) { try { return JSON.parse(localStorage.getItem('mise-shopping-v1') || '[]'); } catch { return []; } }
      return this.transaction('readonly', os => os.getAll(),DB_SHOPPING);
    },
    async shoppingBulkPut(items) {
      if (!items.length) return;
      if (fallback) { const map=new Map((await this.shoppingAll()).map(i=>[i.id,i]));items.forEach(i=>map.set(i.id,i));localStorage.setItem('mise-shopping-v1',JSON.stringify([...map.values()]));return; }
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(DB_SHOPPING,'readwrite');const os=tx.objectStore(DB_SHOPPING);
        items.forEach(i=>os.put(i));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
    },
    async shoppingRemove(ids) {
      if (!ids.length) return;
      if (fallback) { localStorage.setItem('mise-shopping-v1',JSON.stringify((await this.shoppingAll()).filter(i=>!ids.includes(i.id))));return; }
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(DB_SHOPPING,'readwrite');const os=tx.objectStore(DB_SHOPPING);
        ids.forEach(itemId=>os.delete(itemId));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
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
    $('#topbar-section').textContent = view === 'shopping' ? 'LISTA DELLA SPESA' : view === 'favorites' ? 'PREFERITE' : 'TUTTE LE RICETTE';
    $('#collection-title').childNodes[0].textContent = view === 'favorites' ? 'Le preferite ' : 'Le mie ricette ';
    $('#hero-section').hidden = view === 'shopping';
    $('.collection').hidden = view === 'shopping';
    $('#shopping-section').hidden = view !== 'shopping';
    render();
    if (window.innerWidth < 800) (view === 'shopping' ? $('#shopping-section') : $('.collection')).scrollIntoView({behavior:'smooth',block:'start'});
  }
  function render() {
    const recipes = displayRecipes();
    const favorites = state.recipes.filter(r => r.favorite).length;
    $('#nav-all-count').textContent = state.recipes.length;
    $('#nav-fav-count').textContent = favorites;
    $('#nav-shop-count').textContent = state.shopping.filter(i=>!i.checked).length;
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
    renderShopping();
  }
  function renderShopping() {
    const pending=state.shopping.filter(i=>!i.checked), done=state.shopping.filter(i=>i.checked);
    $('#shopping-summary').textContent = `${pending.length} ${pending.length===1?'prodotto da comprare':'prodotti da comprare'}${done.length?` · ${done.length} acquistati`:''}`;
    $('#shopping-clear-done').hidden=!done.length;
    $('#shopping-empty').hidden=!!state.shopping.length;
    const group=(title,items)=>items.length?`<section class="shopping-group"><h3>${title} <span>${String(items.length).padStart(2,'0')}</span></h3>${items.map(item=>`<div class="shopping-item ${item.checked?'is-done':''}"><label class="shopping-item-main"><input type="checkbox" data-shop-check="${attr(item.id)}" ${item.checked?'checked':''}><span class="shopping-item-name">${escapeHTML(item.name)}${item.source?`<small>Da ${escapeHTML(item.source)}</small>`:''}</span></label><span class="shopping-item-amount">${escapeHTML([item.qty,item.unit].filter(Boolean).join(' ')||'—')}</span><button type="button" class="row-remove" data-shop-remove="${attr(item.id)}" aria-label="Rimuovi ${attr(item.name)}">${icon('close')}</button></div>`).join('')}</section>`:'';
    $('#shopping-list').innerHTML=group('Da comprare',pending)+group('Acquistati',done);
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

  function unitOptions(chosen='') { return [...new Set([...UNITS,chosen])].map(unit=>`<option value="${attr(unit)}" ${unit===chosen?'selected':''}>${escapeHTML(unit||'—')}</option>`).join(''); }
  function alternativeRow(item={}) {
    return `<div class="alternative-row"><span class="alternative-label">oppure</span><div class="ingredient-row"><input class="row-control alt-qty" aria-label="Quantità alternativa" placeholder="Qtà" value="${attr(item.qty||'')}" inputmode="decimal"><select class="row-control alt-unit" aria-label="Unità alternativa">${unitOptions(item.unit||'')}</select><input class="row-control alt-name" aria-label="Ingrediente alternativo" placeholder="Alternativa" maxlength="200" value="${attr(item.name||'')}"><button type="button" class="row-remove" data-remove-alternative aria-label="Rimuovi alternativa">${icon('close')}</button></div></div>`;
  }
  function ingredientRow(ingredient={}) {
    return `<div class="ingredient-block"><div class="ingredient-row"><input class="row-control ingredient-qty" aria-label="Quantità" placeholder="Qtà" value="${attr(ingredient.qty||'')}" inputmode="decimal"><select class="row-control ingredient-unit" aria-label="Unità di misura">${unitOptions(ingredient.unit||'')}</select><input class="row-control ingredient-name" aria-label="Nome ingrediente" placeholder="Ingrediente" value="${attr(ingredient.name||'')}" maxlength="200"><button type="button" class="row-remove" data-remove-ingredient aria-label="Rimuovi ingrediente">${icon('close')}</button></div><div class="alternative-rows">${(ingredient.alternatives||[]).map(alternativeRow).join('')}</div><button type="button" class="add-alternative" data-add-alternative>${icon('plus')} Alternativa</button></div>`;
  }
  function stepRow(text='') {
    return `<div class="step-row"><span class="row-index">1</span><textarea class="row-control step-textarea" aria-label="Passaggio" rows="2" placeholder="Descrivi questo passaggio..." maxlength="5000">${escapeHTML(text)}</textarea><button type="button" class="row-remove" data-remove-row aria-label="Rimuovi passaggio">${icon('close')}</button></div>`;
  }
  function prepSectionRow(section={title:'',parallel:false,steps:['']}) {
    const steps=section.steps?.length?section.steps:[''];
    return `<div class="prep-section"><div class="prep-section-top"><span class="prep-section-number">FASE 01</span><button type="button" class="row-remove" data-remove-section aria-label="Rimuovi sezione">${icon('close')}</button></div><input class="row-control prep-section-name" aria-label="Nome della sezione" placeholder="Es. Marinatura, salsa, cottura..." maxlength="150" value="${attr(section.title||'')}"><label class="prep-parallel-label"><input type="checkbox" class="prep-parallel" ${section.parallel?'checked':''}> Da preparare nel frattempo</label><div class="section-step-rows dynamic-rows">${steps.map(stepRow).join('')}</div><button type="button" class="add-row-button add-bottom section-add-step" data-add-section-step>${icon('plus')} Aggiungi passaggio</button></div>`;
  }
  function renumberSteps() {
    $$('.prep-section').forEach((section,i)=>{
      $('.prep-section-number',section).textContent=`FASE ${String(i+1).padStart(2,'0')}`;
      $$('.row-index',section).forEach((el,j)=>{el.textContent=String(j+1).padStart(2,'0');});
    });
  }
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
    const sections=data.sections?.length?data.sections:[{title:'Preparazione',parallel:false,steps:data.steps?.length?data.steps:['']}];
    $('#prep-sections').innerHTML=sections.map(prepSectionRow).join('');
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
    return $$('.ingredient-block').map(block=>({qty:$('.ingredient-qty',block).value.trim(),unit:$('.ingredient-unit',block).value,name:$('.ingredient-name',block).value.trim(),alternatives:$$('.alternative-row',block).map(row=>({qty:$('.alt-qty',row).value.trim(),unit:$('.alt-unit',row).value,name:$('.alt-name',row).value.trim()})).filter(item=>item.name)})).filter(item=>item.name);
  }
  function readSections(){
    return $$('.prep-section').map(block=>({title:$('.prep-section-name',block).value.trim()||'Preparazione',parallel:$('.prep-parallel',block).checked,steps:$$('.step-textarea',block).map(el=>el.value.trim()).filter(Boolean)})).filter(section=>section.steps.length);
  }
  async function saveRecipe(event) {
    event.preventDefault();
    const title=$('#recipe-title').value.trim();
    if (!title) { $('#recipe-title').focus(); return; }
    const old = state.editingId ? getRecipe(state.editingId) : null;
    const now = new Date().toISOString();
    const sections=readSections();
    const recipe = {
      id:old?.id || id(),createdAt:old?.createdAt || now,updatedAt:now,
      title,description:$('#recipe-description').value.trim(),category:$('#recipe-category').value,
      difficulty:$('#recipe-difficulty').value,prep:Math.max(0,Number($('#recipe-prep').value)||0),cook:Math.max(0,Number($('#recipe-cook').value)||0),
      servings:Math.max(1,Number($('#recipe-servings').value)||2),
      ingredients:readIngredientRows(),sections,steps:sections.flatMap(section=>section.steps),
      tags:[...new Set($('#recipe-tags').value.split(',').map(t=>t.trim()).filter(Boolean))],notes:$('#recipe-notes').value.trim(),favorite:$('#recipe-favorite').checked,photo:state.photo
    };
    const button=$('#save-recipe');button.disabled=true;
    try { await store.put(recipe); closeDialog($('#editor-dialog')); await refresh(); toast(old ? 'Ricetta aggiornata con successo':'Ricetta salvata nel tuo ricettario'); }
    catch(e){ console.error(e);toast('Salvataggio non riuscito. Prova a esportare un backup o liberare spazio sul dispositivo.'); }
    finally{button.disabled=false;}
  }
  async function refresh(){[state.recipes,state.shopping]=await Promise.all([store.all(),store.shoppingAll()]);render();}
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
  function recipeSections(recipe){
    return recipe.sections?.length?recipe.sections:[{title:'Preparazione',parallel:false,steps:recipe.steps||[]}];
  }
  function chosenIngredient(ingredient,index){
    const options=[ingredient,...(ingredient.alternatives||[])];
    return options[state.choices.get(index)||0]||ingredient;
  }
  async function addShoppingItems(items,source=''){
    const changed=[];
    const working=[...state.shopping];
    for(const ingredient of items){
      if(!ingredient?.name?.trim())continue;
      const name=ingredient.name.trim(),qty=String(ingredient.qty||'').trim(),unit=ingredient.unit||'';
      const existing=working.find(i=>!i.checked&&normalized(i.name)===normalized(name)&&normalized(i.unit)===normalized(unit));
      const parse=n=>/^\d+(?:[.,]\d+)?$/.test(n)?Number(n.replace(',','.')):null;
      const a=existing?parse(String(existing.qty)):null,b=parse(qty);
      if(existing&&a!==null&&b!==null){
        const updated={...existing,qty:formatNumber(a+b),source:existing.source===source?source:'Più ricette'};
        working[working.indexOf(existing)]=updated;changed.push(updated);
      }else{
        const item={id:id(),name,qty,unit,source,checked:false,createdAt:new Date().toISOString()};working.push(item);changed.push(item);
      }
    }
    if(!changed.length){toast('Nessun ingrediente da aggiungere');return;}
    try{await store.shoppingBulkPut(changed);state.shopping=await store.shoppingAll();render();toast(`${items.length===1?'Ingrediente aggiunto':'Ingredienti aggiunti'} alla lista della spesa`);}
    catch(e){console.error(e);toast('Impossibile salvare la lista della spesa');}
  }
  async function addRecipeIngredients(index=null){
    const recipe=getRecipe(state.detailId);if(!recipe)return;
    const ratio=state.servings/(Number(recipe.servings)||2);
    const list=(recipe.ingredients||[]).map((main,i)=>{
      const item=chosenIngredient(main,i);
      return {...item,qty:scaledQuantity(item.qty,ratio)};
    });
    await addShoppingItems(index===null?list:[list[index]],recipe.title);
  }
  function renderDetail(){
    const recipe=getRecipe(state.detailId);if(!recipe){closeDialog($('#detail-dialog'));return;}
    const ratio=state.servings/(Number(recipe.servings)||2);
    const photo=safePhoto(recipe.photo);
    const ingredients=(recipe.ingredients||[]).map((ingredient,index)=>{
      const selected=chosenIngredient(ingredient,index);
      const amount=[scaledQuantity(selected.qty,ratio),selected.unit].filter(Boolean).join(' ');
      const alternatives=ingredient.alternatives||[];
      const choice=alternatives.length?`<select class="detail-alternative-select" data-choice-ingredient="${index}" aria-label="Scegli alternativa per ${attr(ingredient.name)}"><option value="0" ${(state.choices.get(index)||0)===0?'selected':''}>Principale: ${escapeHTML(ingredient.name)}</option>${alternatives.map((item,j)=>`<option value="${j+1}" ${(state.choices.get(index)||0)===j+1?'selected':''}>Oppure: ${escapeHTML(item.name)}</option>`).join('')}</select>`:'';
      return `<li class="detail-ingredient ${state.checked.has(index)?'checked':''}"><div class="detail-ingredient-line"><input type="checkbox" data-check-ingredient="${index}" aria-label="Spunta ${attr(selected.name)}" ${state.checked.has(index)?'checked':''}><span class="detail-ingredient-text">${amount?`<strong>${escapeHTML(amount)}</strong> · `:''}${escapeHTML(selected.name)}</span><button type="button" class="ingredient-to-shop" data-shop-ingredient="${index}" aria-label="Aggiungi ${attr(selected.name)} alla spesa" title="Aggiungi alla spesa">${icon('cart')}${icon('plus')}</button></div>${choice}</li>`;
    }).join('') || '<li><span>Non hai ancora inserito ingredienti.</span></li>';
    const steps=recipeSections(recipe).map((section,sIndex)=>`<div class="detail-prep-section"><div class="detail-prep-heading"><h4>${escapeHTML(section.title||`Fase ${sIndex+1}`)}</h4>${section.parallel?'<span class="parallel-badge">NEL FRATTEMPO</span>':''}</div><ol class="steps-list">${(section.steps||[]).map((step,index)=>`<li><span class="step-num">${String(index+1).padStart(2,'0')}</span><span class="step-copy">${escapeHTML(step)}</span></li>`).join('')}</ol></div>`).join('') || '<p>Nessun passaggio inserito.</p>';
    $('#detail-content').innerHTML=`<div class="detail-top"><div class="detail-cover">${photo?`<img src="${attr(photo)}" alt="${attr(recipe.title)}">`:'<span>m.</span>'}</div><div class="detail-intro"><div class="detail-category">${escapeHTML(recipe.category||'Altro')} · ${escapeHTML(recipe.difficulty||'Facile')}</div><h2 id="detail-title">${escapeHTML(recipe.title)}</h2><p>${escapeHTML(recipe.description||'Una ricetta del tuo ricettario personale.')}</p><div class="detail-meta"><span>${icon('clock')} ${duration(minutes(recipe))}</span><span>${icon('users')} ${Number(recipe.servings)||2} porzioni</span></div></div><button class="icon-button detail-close" data-detail-action="close" aria-label="Chiudi">${icon('close')}</button></div>
    <div class="detail-toolbar"><button class="detail-fav ${recipe.favorite?'active':''}" data-detail-action="favorite">${icon('heart')} <span>${recipe.favorite?'Preferita':'Preferiti'}</span></button><button data-detail-action="edit">${icon('edit')} Modifica</button><button data-detail-action="print">${icon('print')} Stampa</button><button data-detail-action="export">${icon('download')} Esporta JSON</button><span class="detail-spacer"></span><button class="danger" data-detail-action="delete">${icon('trash')} Elimina</button></div>
    <div class="detail-body"><section><h3>Ingredienti</h3><div class="servings-control"><span>Adatta le quantità</span><div class="servings-stepper"><button data-servings="-1" aria-label="Diminuisci porzioni">−</button><strong>${state.servings}</strong><button data-servings="1" aria-label="Aumenta porzioni">+</button></div></div><button type="button" class="shop-all-button" data-detail-action="add-all">${icon('cart')} Aggiungi tutti alla spesa</button><ul class="ingredients-list">${ingredients}</ul></section><section><h3>Preparazione</h3>${steps}${recipe.notes?`<div class="detail-notes"><h4>Un piccolo appunto</h4><p>${escapeHTML(recipe.notes)}</p></div>`:''}${recipe.tags?.length?`<div class="detail-tags">${recipe.tags.map(tag=>`<span class="detail-tag"># ${escapeHTML(tag)}</span>`).join('')}</div>`:''}</section></div>`;
  }
  function openDetail(recipeId){
    const recipe=getRecipe(recipeId);if(!recipe)return;
    state.detailId=recipeId;state.servings=Number(recipe.servings)||2;state.checked=new Set();state.choices=new Map();renderDetail();openDialog('#detail-dialog');
    // Safari iOS può conservare uno scroll orizzontale del dialog precedente.
    $('#detail-dialog').scrollLeft=0;
  }
  async function deleteRecipe(){
    const recipe=getRecipe(state.detailId);if(!recipe)return;
    if(!window.confirm(`Vuoi eliminare “${recipe.title}”? L'operazione non può essere annullata.`))return;
    try{await store.remove(recipe.id);closeDialog($('#detail-dialog'));state.detailId=null;await refresh();toast('Ricetta eliminata');}
    catch(e){console.error(e);toast('Impossibile eliminare la ricetta');}
  }
  function downloadJSON(payload,filename){
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  function filenamePart(value){
    return normalized(value).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,65)||'ricetta';
  }
  function exportSingleRecipe(){
    const recipe=getRecipe(state.detailId);if(!recipe)return;
    try{
      downloadJSON({application:'mise',version:1,exportedAt:new Date().toISOString(),recipe},`mise-${filenamePart(recipe.title)}.json`);
      toast(`Esportata: ${recipe.title}`);
    }catch(e){console.error(e);toast('Non è stato possibile esportare la ricetta');}
  }
  async function exportBackup(){
    try{
      const archive={application:'mise',version:1,exportedAt:new Date().toISOString(),recipes:await store.all(),shopping:await store.shoppingAll()};
      downloadJSON(archive,`mise-ricettario-${new Date().toISOString().slice(0,10)}.json`);
      toast(`Backup pronto: ${archive.recipes.length} ricette`);
    }catch(e){console.error(e);toast('Non è stato possibile esportare il ricettario');}
  }
  function validateImport(data){
    if(!data || typeof data!=='object')throw new Error('Il JSON non contiene ricette valide.');
    if(data.application==='mise' && data.version!==1)throw new Error('Questa versione del backup Mise non è supportata.');

    let rawRecipes,rawShopping=[];
    if(Array.isArray(data))rawRecipes=data;
    else if(Array.isArray(data.recipes)||Array.isArray(data.ricette)){
      rawRecipes=data.recipes||data.ricette;
      rawShopping=data.shopping??[];
    }else if(data.recipe||data.ricetta)rawRecipes=[data.recipe||data.ricetta];
    else if(typeof(data.title??data.titolo??data.nome)==='string')rawRecipes=[data];
    else throw new Error('JSON non riconosciuto: serve una ricetta o un elenco di ricette.');
    if(rawRecipes.length>2000)throw new Error('Il file contiene troppe ricette.');
    if(!Array.isArray(rawShopping)||rawShopping.length>4000)throw new Error('La lista della spesa nel file non è valida.');

    const cleanIngredient=value=>{
      const i=typeof value==='string'?{name:value}:value;
      return {qty:String(i?.qty??i?.quantita??i?.quantità??'').slice(0,50),unit:String(i?.unit??i?.unita??i?.unità??'').slice(0,40),name:String(i?.name??i?.nome??i?.ingrediente??'').slice(0,200)};
    };
    const cleanSteps=value=>{
      const items=Array.isArray(value)?value:typeof value==='string'?value.split(/\n+/).filter(Boolean):[];
      return items.slice(0,100).map(item=>String(typeof item==='object'&&item!==null?(item.text??item.testo??item.descrizione??item.description??''):item).trim().slice(0,5000)).filter(Boolean);
    };
    const recipes=rawRecipes.map(r=>{
      const title=r?.title??r?.titolo??r?.nome;
      if(!r||typeof r!=='object'||typeof title!=='string'||!title.trim())throw new Error('Una ricetta non ha un titolo valido.');
      const rawSections=r.sections??r.fasi??r.sezioni;
      const sections=Array.isArray(rawSections)?rawSections.slice(0,40).map(s=>({title:String(s?.title??s?.titolo??'Preparazione').slice(0,150),parallel:!!(s?.parallel??s?.inParallelo??s?.nelFrattempo),steps:cleanSteps(s?.steps??s?.passaggi??s?.preparazione)})):[];
      const rawIngredients=r.ingredients??r.ingredienti;
      const steps=sections.length?sections.flatMap(s=>s.steps):cleanSteps(r.steps??r.passaggi??r.procedimento??r.preparazione);
      const rawTags=r.tags??r.etichette;
      const category=r.category??r.categoria;
      const difficulty=r.difficulty??r.difficolta??r.difficoltà;
      return {
        id:typeof r.id==='string'&&r.id.length<=150&&r.id?r.id:id(),
        title:title.trim().slice(0,130),description:String(r.description??r.descrizione??'').slice(0,1000),
        category:CATEGORIES.includes(category)?category:'Altro',difficulty:['Facile','Media','Impegnativa'].includes(difficulty)?difficulty:'Facile',
        prep:Math.max(0,Number(r.prep??r.tempoPreparazione??r.tempo_preparazione)||0),
        cook:Math.max(0,Number(r.cook??r.tempoCottura??r.tempo_cottura)||0),
        servings:Math.max(1,Number(r.servings??r.porzioni)||2),
        ingredients:Array.isArray(rawIngredients)?rawIngredients.slice(0,200).map(i=>({...cleanIngredient(i),alternatives:Array.isArray(i?.alternatives??i?.alternative)?(i.alternatives??i.alternative).slice(0,20).map(cleanIngredient):[]})):[],
        steps,sections,tags:Array.isArray(rawTags)?rawTags.slice(0,80).map(t=>String(t).slice(0,60)):[],
        notes:String(r.notes??r.note??'').slice(0,20000),photo:safePhoto(r.photo),favorite:!!r.favorite,
        createdAt:r.createdAt||new Date().toISOString(),updatedAt:r.updatedAt||new Date().toISOString()
      };
    });
    const shopping=rawShopping.filter(i=>i&&typeof i.name==='string'&&i.name.trim()).map(i=>({id:typeof i.id==='string'&&i.id.length<150?i.id:id(),name:i.name.slice(0,200),qty:String(i.qty||'').slice(0,50),unit:String(i.unit||'').slice(0,40),source:String(i.source||'').slice(0,130),checked:!!i.checked,createdAt:i.createdAt||new Date().toISOString()}));
    return {recipes,shopping};
  }
  function importSignature(recipe){
    const sections=Array.isArray(recipe.sections)&&recipe.sections.length?recipe.sections:null;
    return JSON.stringify({title:normalized(recipe.title).trim(),description:recipe.description||'',category:recipe.category||'',difficulty:recipe.difficulty||'',prep:recipe.prep||0,cook:recipe.cook||0,servings:recipe.servings||2,ingredients:recipe.ingredients||[],steps:sections||recipe.steps||[],tags:recipe.tags||[],notes:recipe.notes||'',photo:recipe.photo||''});
  }
  function preserveExisting(imported,current,signature){
    const identifiers=new Set(current.map(item=>item.id));
    const signatures=new Set(current.map(signature));
    let skipped=0;
    const additions=[];
    for(const item of imported){
      const fingerprint=signature(item);
      if(signatures.has(fingerprint)){skipped++;continue;}
      const next={...item};
      while(identifiers.has(next.id))next.id=id();
      identifiers.add(next.id);signatures.add(fingerprint);additions.push(next);
    }
    return {additions,skipped};
  }
  async function importSingleRecipe(file){
    if(!file)return;
    if(file.size>90*1024*1024){toast('Il file è troppo grande (massimo 90 MB).');return;}
    try{
      const data=JSON.parse(await file.text());const records=validateImport(data);
      if(records.recipes.length!==1)throw new Error('Per importare una ricetta, scegli un JSON che contenga esattamente una ricetta. Per un backup completo usa Importazione globale.');
      const currentRecipes=await store.all();
      const recipeMerge=preserveExisting(records.recipes,currentRecipes,importSignature);
      if(!recipeMerge.additions.length){toast('Ricetta già presente: nessun dato modificato');return;}
      if(!window.confirm(`Aggiungere “${recipeMerge.additions[0].title}” al tuo ricettario?\nNessuna ricetta esistente verrà modificata o eliminata.`))return;
      await store.import(recipeMerge.additions);
      await refresh();closeDialog($('#settings-dialog'));toast('Ricetta aggiunta, senza sovrascritture');
    }catch(e){console.error(e);toast(e instanceof SyntaxError?'Il file JSON non è leggibile':e.message||'Importazione non riuscita');}
    finally{$('#single-recipe-file').value='';}
  }
  async function importGlobalBackup(file){
    if(!file)return;
    if(file.size>90*1024*1024){toast('Il file è troppo grande (massimo 90 MB).');return;}
    try{
      const data=JSON.parse(await file.text());
      if(data?.application!=='mise'||data.version!==1||!Array.isArray(data.recipes)||!Array.isArray(data.shopping)){
        throw new Error('Per sostituire l’archivio serve un backup globale Mise, con ricette e lista della spesa.');
      }
      const records=validateImport(data);
      if(new Set(records.recipes.map(r=>r.id)).size!==records.recipes.length||new Set(records.shopping.map(s=>s.id)).size!==records.shopping.length){
        throw new Error('Il backup contiene identificativi duplicati. Nessun dato è stato modificato.');
      }
      const currentRecipes=await store.all(),currentShopping=await store.shoppingAll();
      if(!window.confirm(`ATTENZIONE: IMPORTAZIONE GLOBALE\n\nI dati presenti su questo dispositivo saranno eliminati e sostituiti da quelli del file.\n\nAttuali: ${currentRecipes.length} ricette e ${currentShopping.length} prodotti della spesa.\nNel file: ${records.recipes.length} ricette e ${records.shopping.length} prodotti.\n\nHai già esportato un backup dei tuoi dati attuali? Vuoi continuare?`))return;
      if(!window.confirm('ULTIMA CONFERMA\n\nConfermi di voler CANCELLARE tutte le ricette e la lista della spesa attuali e sostituirle con il contenuto del file?\n\nQuesta operazione non può essere annullata senza un backup precedente.'))return;
      await store.replaceAll(records.recipes,records.shopping);
      await refresh();closeDialog($('#settings-dialog'));
      toast(`Archivio sostituito: ${records.recipes.length} ricette importate`);
    }catch(e){console.error(e);toast(e instanceof SyntaxError?'Il file JSON non è leggibile':e.message||'Importazione globale non riuscita');}
    finally{$('#global-backup-file').value='';}
  }

  function wireEvents(){
    $$('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
    ['logo-link','mobile-logo-link'].forEach(name=>$('#'+name).addEventListener('click',event=>{event.preventDefault();setView('all');window.scrollTo({top:0,behavior:'smooth'});}));
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
    $('#add-prep-section').addEventListener('click',()=>{$('#prep-sections').insertAdjacentHTML('beforeend',prepSectionRow({title:'',parallel:false,steps:['']}));renumberSteps();$$('.prep-section-name').at(-1)?.focus();});
    $('#recipe-form').addEventListener('click',event=>{
      const alt=event.target.closest('[data-add-alternative]');
      if(alt){const block=alt.closest('.ingredient-block');$('.alternative-rows',block).insertAdjacentHTML('beforeend',alternativeRow());$$('.alt-name',block).at(-1)?.focus();return;}
      const step=event.target.closest('[data-add-section-step]');
      if(step){const section=step.closest('.prep-section');$('.section-step-rows',section).insertAdjacentHTML('beforeend',stepRow());renumberSteps();$$('.step-textarea',section).at(-1)?.focus();return;}
      const removeAlt=event.target.closest('[data-remove-alternative]');if(removeAlt){removeAlt.closest('.alternative-row').remove();return;}
      const removeIngredient=event.target.closest('[data-remove-ingredient]');if(removeIngredient){removeIngredient.closest('.ingredient-block').remove();return;}
      const removeSection=event.target.closest('[data-remove-section]');if(removeSection){removeSection.closest('.prep-section').remove();renumberSteps();return;}
      const removeStep=event.target.closest('[data-remove-row]');if(removeStep){removeStep.closest('.step-row').remove();renumberSteps();}
    });
    $('#recipe-form').addEventListener('submit',saveRecipe);
    $('#recipe-photo').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{setPhoto(await imageToDataURL(file));}catch(e){toast(e.message);}});
    $('#remove-photo').addEventListener('click',()=>setPhoto(''));
    $('#detail-content').addEventListener('click',async event=>{
      const servingButton=event.target.closest('[data-servings]');if(servingButton){state.servings=Math.min(1000,Math.max(1,state.servings+Number(servingButton.dataset.servings)));renderDetail();return;}
      const shoppingButton=event.target.closest('[data-shop-ingredient]');if(shoppingButton){await addRecipeIngredients(Number(shoppingButton.dataset.shopIngredient));return;}
      const action=event.target.closest('[data-detail-action]')?.dataset.detailAction;
      if(action==='close')closeDialog($('#detail-dialog'));
      if(action==='favorite')await toggleFavorite(state.detailId);
      if(action==='edit'){const recipe=getRecipe(state.detailId);closeDialog($('#detail-dialog'));openEditor(recipe);}
      if(action==='print')window.print();
      if(action==='export')exportSingleRecipe();
      if(action==='add-all')await addRecipeIngredients();
      if(action==='delete')await deleteRecipe();
    });
    $('#detail-content').addEventListener('change',event=>{
      const choice=event.target.closest('[data-choice-ingredient]');if(choice){state.choices.set(Number(choice.dataset.choiceIngredient),Number(choice.value));renderDetail();return;}
      const checkbox=event.target.closest('[data-check-ingredient]');if(!checkbox)return;
      const index=Number(checkbox.dataset.checkIngredient);if(checkbox.checked)state.checked.add(index);else state.checked.delete(index);checkbox.closest('li').classList.toggle('checked',checkbox.checked);
    });
    $('#shopping-add-form').addEventListener('submit',async event=>{
      event.preventDefault();const name=$('#shopping-name').value.trim();if(!name)return;
      await addShoppingItems([{name,qty:$('#shopping-qty').value.trim(),unit:$('#shopping-unit').value}]);
      $('#shopping-add-form').reset();$('#shopping-name').focus();
    });
    $('#shopping-browse').addEventListener('click',()=>setView('all'));
    $('#shopping-list').addEventListener('change',async event=>{
      const checkbox=event.target.closest('[data-shop-check]');if(!checkbox)return;
      const item=state.shopping.find(i=>i.id===checkbox.dataset.shopCheck);if(!item)return;
      try{await store.shoppingBulkPut([{...item,checked:checkbox.checked}]);state.shopping=await store.shoppingAll();render();}
      catch(e){console.error(e);toast('Impossibile aggiornare il prodotto');}
    });
    $('#shopping-list').addEventListener('click',async event=>{
      const button=event.target.closest('[data-shop-remove]');if(!button)return;
      try{await store.shoppingRemove([button.dataset.shopRemove]);state.shopping=await store.shoppingAll();render();}
      catch(e){console.error(e);toast('Impossibile rimuovere il prodotto');}
    });
    $('#shopping-clear-done').addEventListener('click',async()=>{
      const ids=state.shopping.filter(i=>i.checked).map(i=>i.id);if(!ids.length)return;
      if(!window.confirm(`Rimuovere ${ids.length} prodotti già acquistati dalla lista?`))return;
      try{await store.shoppingRemove(ids);state.shopping=await store.shoppingAll();render();toast('Prodotti acquistati rimossi');}
      catch(e){console.error(e);toast('Impossibile aggiornare la lista');}
    });
    $('#export-data').addEventListener('click',exportBackup);
    $('#import-single').addEventListener('click',()=>$('#single-recipe-file').click());
    $('#single-recipe-file').addEventListener('change',event=>importSingleRecipe(event.target.files?.[0]));
    $('#import-global').addEventListener('click',()=>$('#global-backup-file').click());
    $('#global-backup-file').addEventListener('change',event=>importGlobalBackup(event.target.files?.[0]));
  }
  async function init(){
    $('#today-date').textContent=new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'long',year:'numeric'}).format(new Date());
    wireEvents();await store.open();
    if(fallback)toast('Modalità di compatibilità: lo spazio per le foto può essere limitato.');
    try{await refresh();}catch(e){console.error(e);toast('Impossibile leggere il ricettario locale.');}
  }
  init();
})();
