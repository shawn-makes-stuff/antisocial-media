/*
 * Admin panel script for Antisocial Media.
 * Handles site configuration, post CRUD operations,
 * file uploads and tag autocompletion.
 */
(function(){
  'use strict';

  // ====== Local storage / headers ======
  const storage = {
    get secret(){ return localStorage.getItem('admin_secret') || ''; },
    set secret(v){ localStorage.setItem('admin_secret', v || ''); }
  };
  const headers = () => ({ 'Content-Type':'application/json', 'X-Admin-Secret': storage.secret });

  // ====== DOM helpers ======
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  /** Display a toast message within the app for admin feedback. */
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(msg){
    console.log(msg);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> toastEl.classList.remove('show'), 3000);
  }

  // ====== DOM elements ======
  const siteTitle   = $('#site-title');
  const siteDesc    = $('#site-desc');
  const siteAvatar  = $('#site-avatar');
  const avatarFile  = $('#avatar-file');
  const uploadAvatarBtn = $('#upload-avatar');

  const pTitle = $('#p-title');
  const pText  = $('#p-text');
  const pTags  = $('#p-tags');
  const pTagsSuggest = $('#p-tags-suggest');
  const pImage = $('#p-image');
  const pPreviewWrap = $('#p-preview-wrap');
  const pPreviewRow = $('#p-preview-row');
  const createBtn = $('#create-post');

  const postsTableBody = $('#posts-table tbody');

  // Persist admin secret for convenience.
  $('#secret').value = storage.secret;
  $('#save-secret').onclick = ()=>{
    storage.secret = $('#secret').value.trim();
    toast('Secret saved.');
  };

  // ====== API helpers ======
  async function fetchJSON(url){
    const r = await fetch(url, {headers: headers()});
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function postJSON(url, body){
    const r = await fetch(url, {method:'POST', headers: headers(), body: JSON.stringify(body)});
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function putJSON(url, body){
    const r = await fetch(url, {method:'PUT', headers: headers(), body: JSON.stringify(body)});
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function del(url){
    const r = await fetch(url, {method:'DELETE', headers: headers()});
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function uploadFile(file){
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/upload', {method:'POST', headers: {'X-Admin-Secret': storage.secret}, body: fd});
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // ====== Tag utilities + autocomplete ======
  let allTags = []; // global pool from posts

  /** Split a comma separated tag string, trimming and deduping. */
  function splitTags(val){
    return val.split(',').map(t=>t.trim()).filter(Boolean)
      .filter((v,i,arr)=>arr.indexOf(v)===i);
  }

  /** Escape quotes for attribute injection in templates. */
  function escapeAttr(s){ return (s || '').replaceAll('"','&quot;'); }

  /** Extract unique tags from posts and store globally. */
  function setTagPoolFromPosts(posts){
    const set = new Set();
    posts.forEach(p => (p.tags || []).forEach(t => set.add(t)));
    allTags = Array.from(set).sort((a,b)=>a.localeCompare(b));
  }

  /** Refresh tag pool from server and update new-post suggestions. */
  async function refreshTagPool(){
    const data = await fetchJSON('/api/posts');
    setTagPoolFromPosts(data.posts);
    // update top-level suggest for new post form immediately
    renderSuggestions(pTags, pTagsSuggest, allTags);
  }

  /** Attach autocomplete behaviour to a tag input and suggestion container. */
  function attachTagAutocomplete(inputEl, suggEl){
    function onInput(){ renderSuggestions(inputEl, suggEl, allTags); }
    function onFocus(){ renderSuggestions(inputEl, suggEl, allTags); }
    function onBlur(){ setTimeout(()=> suggEl.classList.remove('visible'), 150); }
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('focus', onFocus);
    inputEl.addEventListener('blur', onBlur);
  }

  /** Render suggestion chips based on the current token of the tags input. */
  function renderSuggestions(inputEl, suggEl, pool){
    const existing = splitTags(inputEl.value);
    const currentToken = inputEl.value.split(',').slice(-1)[0].trim().toLowerCase();

    // Suggestions that start with current token, excluding already chosen tags
    let sug = pool.filter(t => !existing.includes(t) && (currentToken ? t.toLowerCase().startsWith(currentToken) : true));
    sug = sug.slice(0, 12); // limit

    suggEl.innerHTML = '';
    if(sug.length === 0){ suggEl.classList.remove('visible'); return; }

    sug.forEach(tag=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sugg-chip';
      btn.textContent = `#${tag}`;
      btn.addEventListener('mousedown', (e)=>{
        e.preventDefault(); // avoid blurring input
        const tokens = inputEl.value.split(',').map(s=>s.trim()).filter(s=>s.length>0);
        if(currentToken){
          // replace last token
          tokens[tokens.length - 1] = tag;
        }else{
          tokens.push(tag);
        }
        // dedupe and join
        const final = tokens.filter((v,i,a)=>a.indexOf(v)===i).join(', ');
        inputEl.value = final + ', '; // add comma for faster chaining
        inputEl.dispatchEvent(new Event('input'));
        inputEl.focus();
      });
      suggEl.appendChild(btn);
    });
    suggEl.classList.add('visible');
  }

  // ====== Post helpers ======

  /**
   * Build a table row for an existing post and wire up save/delete buttons.
   */
  function row(post){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="type-pill">${post.type}</span></td>
      <td><input type="text" class="t-title" value="${escapeAttr(post.title || post.text || '')}"></td>
      <td><input type="text" class="t-url" value="${escapeAttr(post.url||'')}"></td>
      <td><input type="text" class="t-tags" value="${escapeAttr((post.tags||[]).join(', '))}"></td>
      <td><input type="text" class="t-date" value="${escapeAttr(post.date || '')}" style="width:120px"></td>
      <td class="flex">
        <button class="btn b-save">Save</button>
        <button class="btn b-del">Delete</button>
      </td>
    `;

    const tTags = tr.querySelector('.t-tags');

    tr.querySelector('.b-save').onclick = async ()=>{
      try{
        const titleOrText = tr.querySelector('.t-title').value.trim();
        const url  = tr.querySelector('.t-url').value.trim();
        const tags = splitTags(tTags.value);
        const date = tr.querySelector('.t-date').value.trim();
        const body = { tags, date };
        if(post.type === 'text'){
          body.text = titleOrText;
          body.title = undefined;
        }else{
          body.title = titleOrText || undefined;
          if(url) body.url = url;
        }
        await putJSON(`/api/post/${post.id}`, body);
        toast('Saved.');
        await refreshTagPool(); // tags may have changed
      }catch(e){ toast('Save failed: ' + e); }
    };

    tr.querySelector('.b-del').onclick = async ()=>{
      try{
        await del(`/api/post/${post.id}`);
        await loadPosts();
        toast('Post deleted.');
      }catch(e){ toast('Delete failed: ' + e); }
    };
    return tr;
  }

  // ====== Site/profile handlers ======
  async function handleSaveSite(){
    try{
      await putJSON('/api/site', {
        title: siteTitle.value.trim(),
        description: siteDesc.value.trim(),
        avatar: siteAvatar.value.trim()
      });
      toast('Profile saved.');
    }catch(e){ toast('Save failed: ' + e); }
  }

  async function handleUploadAvatar(){
    try{
      const f = avatarFile.files[0];
      if(!f) return toast('Choose a file first.');
      const up = await uploadFile(f);
      siteAvatar.value = up.url;
      toast('Uploaded. Avatar URL set.');
    }catch(e){ toast('Upload failed: ' + e); }
  }

  $('#save-site').onclick = handleSaveSite;
  uploadAvatarBtn.onclick = handleUploadAvatar;

  // ====== Post creation handlers ======
  let attachedImages = [];

  function addFiles(files){
    files.forEach(f=>{
      if(!f.type.startsWith('image/')) return;
      const url = URL.createObjectURL(f);
      attachedImages.push({file: f, url});
      const item = document.createElement('div');
      item.className = 'preview-item';
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'preview';
      item.appendChild(img);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '✖';
      btn.addEventListener('click', ()=>{
        const idx = attachedImages.findIndex(ai=>ai.file===f);
        if(idx>-1){
          URL.revokeObjectURL(attachedImages[idx].url);
          attachedImages.splice(idx,1);
        }
        item.remove();
        if(attachedImages.length===0){
          pPreviewRow.style.display='none';
        }
        toast('Image removed.');
      });
      item.appendChild(btn);
      pPreviewWrap.appendChild(item);
    });
    if(attachedImages.length>0){
      pPreviewRow.style.display='';
    }
  }

  pText.addEventListener('paste', (e)=>{
    const imgs = Array.from(e.clipboardData?.files || []).filter(f=>f.type.startsWith('image/'));
    if(imgs.length){
      addFiles(imgs);
      pImage.value='';
      toast(imgs.length>1 ? 'Images attached.' : 'Image attached.');
      e.preventDefault();
    }
  });

  pImage.addEventListener('change', ()=>{
    const imgs = Array.from(pImage.files).filter(f=>f.type.startsWith('image/'));
    if(imgs.length){
      addFiles(imgs);
      pImage.value='';
      toast(imgs.length>1 ? 'Images attached.' : 'Image attached.');
    }
  });

  async function handleCreatePost(){
    try{
      let r;
      if(attachedImages.length){
        const fd = new FormData();
        fd.append('title', pTitle.value.trim());
        fd.append('text',  pText.value.trim());
        fd.append('tags',  splitTags(pTags.value).join(','));
        attachedImages.forEach(ai=> fd.append('files', ai.file));
        r = await fetch('/api/post', {method:'POST', headers:{'X-Admin-Secret': storage.secret}, body: fd});
      }else{
        const body = {
          title: pTitle.value.trim(),
          text:  pText.value.trim(),
          tags:  splitTags(pTags.value).join(',')
        };
        r = await fetch('/api/post', {method:'POST', headers: headers(), body: JSON.stringify(body)});
      }
      if(!r.ok) throw new Error(await r.text());
      await r.json();
      await loadPosts();
      pTitle.value = pText.value = pTags.value = '';
      pImage.value = '';
      attachedImages.forEach(ai=> URL.revokeObjectURL(ai.url));
      attachedImages = [];
      pPreviewWrap.innerHTML = '';
      pPreviewRow.style.display = 'none';
      toast('Post created.');
    }catch(e){ toast('Create failed: ' + e); }
  }

  createBtn.addEventListener('click', async (e)=>{
    e.preventDefault();
    await handleCreatePost();
  });

  // ====== Loaders ======
  async function loadSite(){
    const site = await fetchJSON('/api/site');
    siteTitle.value = site.title || '';
    siteDesc.value  = site.description || '';
    siteAvatar.value= site.avatar || '';
  }

  async function loadPosts(){
    const data = await fetchJSON('/api/posts');
    setTagPoolFromPosts(data.posts);
    postsTableBody.innerHTML = '';
    data.posts.forEach(p => postsTableBody.appendChild(row(p)));
    // also refresh the new-post suggestion against the current pool
    renderSuggestions(pTags, pTagsSuggest, allTags);
  }

  // Init autocomplete for "new post" tags input
  attachTagAutocomplete(pTags, pTagsSuggest);

  // ====== Bootstrap ======
  (async function init(){
    try{
      await loadSite();
      await loadPosts();
    }catch(e){
      toast('Failed to load admin: ' + e);
    }
  })();
})();

