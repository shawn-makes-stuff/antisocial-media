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

  /** Display a simple alert + log for admin feedback. */
  function toast(msg){
    console.log(msg);
    alert(msg);
  }

  // ====== DOM elements ======
  const siteTitle   = $('#site-title');
  const siteDesc    = $('#site-desc');
  const siteAvatar  = $('#site-avatar');
  const avatarFile  = $('#avatar-file');
  const uploadAvatarBtn = $('#upload-avatar');

  const pType  = $('#p-type');
  const pTitle = $('#p-title');
  const pText  = $('#p-text');
  const pUrl   = $('#p-url');
  const pFile  = $('#p-file');
  const pTags  = $('#p-tags');
  const pTagsSuggest = $('#p-tags-suggest');
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
      <td><input class="t-title" value="${escapeAttr(post.title || post.text || '')}"></td>
      <td><input class="t-url" value="${escapeAttr(post.url||'')}"></td>
      <td>
        <div>
          <input class="t-tags" value="${escapeAttr((post.tags||[]).join(', '))}">
          <div class="tag-suggest"></div>
        </div>
      </td>
      <td><input class="t-date" value="${escapeAttr(post.date || '')}" style="width:120px"></td>
      <td class="flex">
        <button class="btn b-save">Save</button>
        <button class="btn b-del">Delete</button>
      </td>
    `;

    const tTags = tr.querySelector('.t-tags');
    const sugg  = tr.querySelector('.tag-suggest');
    attachTagAutocomplete(tTags, sugg);

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
      if(!confirm('Delete this post?')) return;
      try{
        await del(`/api/post/${post.id}`);
        await loadPosts();
        toast('Deleted.');
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
  async function handleCreatePost(){
    try{
      const type = pType.value;
      const body = {
        type,
        title: pTitle.value.trim() || undefined,
        text:  pText.value.trim() || undefined,
        url:   pUrl.value.trim() || undefined,
        tags:  splitTags(pTags.value)
      };
      await postJSON('/api/post', body);
      await loadPosts();
      pTitle.value = pText.value = pUrl.value = pTags.value = '';
      pFile.value = '';
      toast('Post created.');
    }catch(e){ toast('Create failed: ' + e); }
  }

  async function handleUploadPhoto(){
    try{
      const f = pFile.files[0];
      if(!f) return toast('Choose a file first.');
      const up = await uploadFile(f);
      pUrl.value = up.url;
      toast('Uploaded. URL set.');
    }catch(e){ toast('Upload failed: ' + e); }
  }

  createBtn.onclick = handleCreatePost;
  $('#upload-photo').onclick = handleUploadPhoto;

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

