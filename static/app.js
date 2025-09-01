// ---------- small helpers ----------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const state = {
  posts: [],
  query: "",
  type: "all",
  tag: null,
  tagsExpanded: false,   // NEW: controls collapse/expand
  dateFrom: null,   // NEW
  dateTo: null      // NEW
};

const tagWrap   = $("#tagbar-wrap");     // NEW
const tagToggle = $("#tag-toggle");      // NEW
const dateFromInput = $("#date-from");
const dateToInput   = $("#date-to");
const dateClearBtn  = $("#date-clear");

function parseDateISO(d){ return d ? new Date(d + "T00:00:00") : null; }

dateFromInput.addEventListener("change", ()=>{
  state.dateFrom = dateFromInput.value || null;
  render();
});
dateToInput.addEventListener("change", ()=>{
  state.dateTo = dateToInput.value || null;
  render();
});
dateClearBtn.addEventListener("click", ()=>{
  dateFromInput.value = "";
  dateToInput.value = "";
  state.dateFrom = state.dateTo = null;
  render();
});

function renderMarkdown(md) {
  if (!md) return "";
  try {
    if (window.marked) {
      marked.setOptions({ gfm: true, breaks: true }); // soft line-breaks → <br>
      const raw = marked.parse(md);
      const clean = window.DOMPurify
        ? DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
        : raw;
      return clean;
    }
  } catch (_) {}
  // Fallback: escape + simple line breaks
  return String(md)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function applyTagCollapse(){
  if(!tagWrap) return;
  tagWrap.classList.toggle("collapsed", !state.tagsExpanded);
  if(tagToggle){
    tagToggle.textContent = state.tagsExpanded ? "Less" : "More";
    tagToggle.setAttribute("aria-expanded", String(state.tagsExpanded));
  }
}
if(tagToggle){
  tagToggle.addEventListener("click", ()=>{
    state.tagsExpanded = !state.tagsExpanded;
    applyTagCollapse();
  });
}

async function fetchJSON(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function fmtDate(iso){
  if(!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"numeric"});
}

function isYouTube(url){
  const p1 = /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_\-]{6,})/;
  const p2 = /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([A-Za-z0-9_\-]{6,})/;
  return (url.match(p1) || url.match(p2))?.[1] || null;
}

function youtubeThumbUrl(id){
  // Try maxres first, fall back to hqdefault automatically
  return {
    primary: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    fallback: `https://img.youtube.com/vi/${id}/hqdefault.jpg`
  };
}

function buildVideoThumb(id, title){
  const wrap = document.createElement("div");
  wrap.className = "video-thumb";
  const img = new Image();
  img.loading = "lazy";
  const { primary, fallback } = youtubeThumbUrl(id);
  img.src = primary;
  img.alt = title || "video";
  img.onerror = () => { img.onerror = null; img.src = fallback; }; // graceful fallback
  wrap.appendChild(img);

  const badge = document.createElement("div");
  badge.className = "play-badge";
  badge.textContent = "▶";
  wrap.appendChild(badge);

  return wrap;
}

// ---------- state & DOM ----------

const grid       = $("#grid");
const cardTpl    = $("#card-tpl");
const tagBar     = $("#tag-bar");
const searchInput= $("#search");
const typeChips = $$('.chip[data-type]');
const modal      = $("#modal");
const modalBody  = $("#modal-body");
const year       = $("#year");

// intro elements (filled from /api/site)
const introTitle  = document.querySelector("header .intro h1");
const introDesc   = document.querySelector("header .intro .muted");
const introAvatar = document.querySelector("header .intro .avatar");

year.textContent = new Date().getFullYear();

// ---------- tag utilities ----------
function collectAllTags(posts){
  const set = new Set();
  posts.forEach(p => (p.tags || []).forEach(t => set.add(t)));
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

function renderTagBar(allTags){
  tagBar.innerHTML = "";
  allTags.forEach(t=>{
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = `#${t}`;
    btn.onclick = () => {
      state.tag = state.tag === t ? null : t;
      render();
    };
    tagBar.appendChild(btn);
  });
  applyTagCollapse(); // ensure correct collapsed/expanded state after rendering
}

// ---------- card rendering ----------
function renderCard(post){
  const node = cardTpl.content.firstElementChild.cloneNode(true);
  const thumb = node.querySelector('[data-role="thumb"]');
  const title = node.querySelector('[data-role="title"]');
  const desc  = node.querySelector('[data-role="desc"]');
  const date  = node.querySelector('[data-role="date"]');
  const tags  = node.querySelector('[data-role="tags"]');

  date.textContent = fmtDate(post.date);
  title.textContent = post.title || "";
  if(!post.title){ title.style.display = "none"; }

  // description (truncated by CSS)
  desc.textContent = post.text || post.description || "";

  // tags
  (post.tags || []).forEach(t=>{
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = `#${t}`;
    tags.appendChild(el);
  });

  // thumbnail / media placeholder
  if(post.type === "photo"){
    const img = new Image();
    img.loading = "lazy";
    img.src = post.url;
    img.alt = post.title || "photo";
    thumb.appendChild(img);
  } else if(post.type === "video"){
  const id = isYouTube(post.url);
  if(id){
    thumb.appendChild(buildVideoThumb(id, post.title));
  } else {
    // Non-YouTube link? Show a generic panel.
    const vid = document.createElement("div");
    vid.style.display = "grid";
    vid.style.placeItems = "center";
    vid.style.fontSize = "14px";
    vid.style.color = "#cfe2ff";
    vid.textContent = "▶ Video";
    thumb.appendChild(vid);
  }
} else if(post.type === "link"){
  makeLinkCard(thumb, post.url, post.title);
  } else if(post.type === "text"){
  const wrap = document.createElement("div");
  wrap.className = "text-thumb";
  const h = document.createElement("h3");
  h.className = "text-thumb__title";
  // prefer title; if missing, fall back to first part of the text
  const fallback = (post.text || "").trim().slice(0, 120);
  h.textContent = post.title || fallback || "Text";
  wrap.appendChild(h);
  thumb.appendChild(wrap);

  // Optional: avoid repeating the title below the thumb for text posts
  // If you prefer to keep the title in the body too, delete the next line.
  title.style.display = "none";
}

  // click → open modal
  node.addEventListener("click", ()=>openPost(post));
  return node;
}

async function makeLinkCard(container, url, fallbackTitle){
  const wrap = document.createElement("div");
  wrap.className = "link-card";

  const img  = new Image();
  img.className = "link-card__img";
  img.loading = "lazy";

  const text = document.createElement("div");
  text.className = "link-card__text";
  const h    = document.createElement("h3");
  h.className = "link-card__title";
  const p    = document.createElement("p");
  p.className = "link-card__desc";

  text.appendChild(h);
  text.appendChild(p);
  wrap.appendChild(img);
  wrap.appendChild(text);
  container.appendChild(wrap);

  // Show something instantly (domain favicon), then upgrade with OG image
  try{
    const u = new URL(url, window.location.href);
    img.src = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=128`;

    const q = `/api/preview?url=${encodeURIComponent(u.href)}`;
    const meta = await fetchJSON(q);

    h.textContent = meta.title || fallbackTitle || u.hostname;
    p.textContent = meta.description || u.hostname;

    if(meta.image){
      img.src = meta.image;
    } else {
      // fallback image if site has no OG image
      img.src = "/static/fallback-link.png";
    }
    img.alt = h.textContent;
  } catch {
    h.textContent = fallbackTitle || url;
    p.textContent = url;
    img.src = "/static/fallback-link.png";
    img.alt = "link";
  }
}

// ---------- filtering & render ----------
function matchesFilters(p){
  const q = state.query.trim().toLowerCase();
  const inQuery = !q || [
    p.title, p.text, p.description, p.url, (p.tags||[]).join(" ")
  ].filter(Boolean).some(s => s.toLowerCase().includes(q));

  const typeOk = state.type === "all" || p.type === state.type;
  const tagOk  = !state.tag || (p.tags||[]).includes(state.tag);

  // NEW — date range (inclusive)
  let dateOk = true;
  if (state.dateFrom || state.dateTo) {
    const d = p.date ? new Date(p.date + "T00:00:00") : null;
    if (!d) {
      // posts without date: exclude when filtering by date
      dateOk = false;
    } else {
      if (state.dateFrom) dateOk = dateOk && d >= parseDateISO(state.dateFrom);
      if (state.dateTo)   dateOk = dateOk && d <= new Date(state.dateTo + "T23:59:59");
    }
  }

  return inQuery && typeOk && tagOk && dateOk;
}

function render(){
  grid.innerHTML = "";
  state.posts.filter(matchesFilters).forEach(p => {
    grid.appendChild(renderCard(p));
  });

  // update active states
typeChips.forEach(chip => chip.addEventListener("click", ()=>{
  state.type = chip.dataset.type;   // guaranteed to exist
  render();
}));
  $$("#tag-bar .chip").forEach(btn=>{
    btn.classList.toggle("active", btn.textContent === `#${state.tag}`);
  });
}

// ---------- modal ----------
function openPost(post){
  modal.classList.remove("hidden");
  modalBody.innerHTML = "";

  if (post.type === "photo") {
    const img = new Image();
    img.src = post.url;
    img.alt = post.title || "photo";
    img.className = "modal__media";
    modalBody.appendChild(img);

    if (post.text) {
      const cap = document.createElement("div");
      cap.className = "modal__desc md";
      cap.innerHTML = renderMarkdown(post.text);
      modalBody.appendChild(cap);
    }

  } else if (post.type === "video") {
    const id = isYouTube(post.url);
    if (id){
      const iframe = document.createElement("iframe");
      iframe.className = "modal__media modal__iframe";
      const origin = encodeURIComponent(location.origin);
      iframe.src = `https://www.youtube.com/embed/${id}?enablejsapi=1&rel=0&origin=${origin}`;
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      modalBody.appendChild(iframe);
    }

  } else if (post.type === "link") {
    const a = document.createElement("a");
    a.href = post.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = post.url;
    modalBody.appendChild(a);

    if (post.text) {
      const note = document.createElement("div");
      note.className = "modal__desc md";
      note.innerHTML = renderMarkdown(post.text);
      modalBody.appendChild(note);
    }

  } else if (post.type === "text") {
    // Optional title
    if (post.title) {
      const h = document.createElement("h3");
      h.className = "modal__title";
      h.textContent = post.title;
      modalBody.appendChild(h);
    }
    // Single Markdown-rendered body (no duplicate plain text)
    const div = document.createElement("div");
    div.className = "modal__desc md";
    div.innerHTML = renderMarkdown(post.text || "");
    modalBody.appendChild(div);
  }

  // Meta (tags + date)
  const meta = document.createElement("div");
  meta.innerHTML = `
    <div class="tags">${(post.tags||[]).map(t=>`<span class="tag">#${t}</span>`).join(" ")}</div>
    <div class="muted">${fmtDate(post.date)}</div>
  `;
  modalBody.appendChild(meta);
}


function closeModal(){
  // Try to pause YouTube players via postMessage, then clean up.
  const iframes = modalBody.querySelectorAll("iframe");
  iframes.forEach((f)=>{
    try{
      if (f.src.includes("youtube.com/embed/")) {
        f.contentWindow?.postMessage(JSON.stringify({
          event: "command",
          func: "pauseVideo",
          args: []
        }), "*");
      }
    }catch(_) {}
  });
  // Clear content ensures playback stops even if pause didn’t work
  modalBody.innerHTML = "";
  modal.classList.add("hidden");
}

// Use closeModal on all close interactions
$$("[data-close]").forEach(el => el.addEventListener("click", closeModal));
modal.addEventListener("click", (e)=>{ if(e.target === modal) closeModal(); });
document.addEventListener("keydown", (e)=>{ if(e.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });

// ---------- boot ----------
typeChips.forEach(c=>{
  c.classList.toggle("active", c.dataset.type === state.type);
});

searchInput.addEventListener("input", (e)=>{
  state.query = e.target.value;
  render();
});

(async function main(){
  try{
    const [site, data] = await Promise.all([
      fetchJSON("/api/site"),
      fetchJSON("/api/posts")
    ]);

    // fill intro header
    introTitle.textContent  = site.title || "Shawn";
    introDesc.textContent   = site.description || "";
    introAvatar.src         = site.avatar || "/static/me.jpg";

    state.posts = data.posts;
    renderTagBar(collectAllTags(state.posts));
    render();
  }catch(err){
    grid.innerHTML = `<div class="muted">Failed to load posts: ${err.message}</div>`;
  }
})();
