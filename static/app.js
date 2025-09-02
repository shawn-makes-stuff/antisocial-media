// ---------- DOM helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- application state ----------
const state = {
  posts: [],
  query: "",
  type: "all",
  tag: null,
  dateFrom: null,
  dateTo: null,
  user: null,
};

// ---------- cached DOM references ----------
const grid = $("#grid");
const cardTpl = $("#card-tpl");
const tagBar = $("#tag-bar");
const searchInput = $("#search");
const typeChips = $$('.chip[data-type]');
const modal = $("#modal");
const modalBody = $("#modal-body");
const modalContent = $(".modal__content");
const year = $("#year");
const authBar = $("#auth-bar");
const newPostBtn = $("#btn-new-post");

const siteLogo = $("#site-logo");
const siteTitleEl = $("#site-title");
const footerTitle = $("#footer-title");

let currentUser = null;

const dateFromInput = $("#date-from");
const dateToInput = $("#date-to");
const dateClearBtn = $("#date-clear");

year.textContent = new Date().getFullYear();

// ---------- utility functions ----------

// Parse ISO date (yyyy-mm-dd) into a Date object or null
function parseDateISO(d) {
  return d ? new Date(d + "T00:00:00") : null;
}

// Minimal Markdown renderer with optional DOMPurify sanitization
function renderMarkdown(md) {
  if (!md) return "";
  try {
    if (window.marked) {
      marked.setOptions({ gfm: true, breaks: true });
      const raw = marked.parse(md);
      const clean = window.DOMPurify
        ? DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
        : raw;
      return clean;
    }
  } catch (_) {}
  // Fallback: escape HTML and convert line breaks
  return String(md)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

// Fetch helper that throws on HTTP errors
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Format an ISO date string for display
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// Detect YouTube video ID from URL
function isYouTube(url) {
  const p1 = /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_\-]{6,})/;
  const p2 = /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([A-Za-z0-9_\-]{6,})/;
  return (url.match(p1) || url.match(p2))?.[1] || null;
}

// Compute primary and fallback YouTube thumbnail URLs
function youtubeThumbUrl(id) {
  return {
    primary: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    fallback: `https://img.youtube.com/vi/${id}/hqdefault.jpg`
  };
}

// Build a clickable YouTube thumbnail element
function buildVideoThumb(id, title) {
  const wrap = document.createElement("div");
  wrap.className = "video-thumb";
  const img = new Image();
  img.loading = "lazy";
  const { primary, fallback } = youtubeThumbUrl(id);
  img.src = primary;
  img.alt = title || "video";
  img.onerror = () => {
    img.onerror = null;
    img.src = fallback;
  };
  wrap.appendChild(img);

  const badge = document.createElement("div");
  badge.className = "play-badge";
  badge.textContent = "▶";
  wrap.appendChild(badge);

  return wrap;
}

// ---------- tag utilities ----------
const TAG_LIMIT = 10;

function collectTopTags(posts) {
  const freq = new Map();
  posts.forEach(p => (p.tags || []).forEach(t => {
    freq.set(t, (freq.get(t) || 0) + 1);
  }));
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TAG_LIMIT)
    .map(([tag]) => tag);
}

function renderTagBar(tags) {
  tagBar.innerHTML = "";
  tags.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = `#${t}`;
    btn.onclick = () => {
      state.tag = state.tag === t ? null : t;
      render();
    };
    tagBar.appendChild(btn);
  });
}

// ---------- card rendering ----------

function renderCard(post) {
  const node = cardTpl.content.firstElementChild.cloneNode(true);
  const thumb = node.querySelector('[data-role="thumb"]');
  const title = node.querySelector('[data-role="title"]');
  const desc = node.querySelector('[data-role="desc"]');
  const date = node.querySelector('[data-role="date"]');
  const tags = node.querySelector('[data-role="tags"]');
  const authorEl = node.querySelector('[data-role="author"]');
  const commentEl = node.querySelector('[data-role="comment-count"]');

  date.textContent = fmtDate(post.date);
  title.textContent = post.title || "";
  if (!post.title) title.style.display = "none";

  authorEl.textContent = post.user ? `by ${post.user.name}` : "";
  commentEl.textContent = `${post.comment_count || 0} comments`;

  // Description (truncated by CSS)
  desc.textContent = post.text || post.description || "";

  // Tags
  (post.tags || []).forEach(t => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = `#${t}`;
    tags.appendChild(el);
  });

  // Thumbnail / media placeholder
  if (post.type === "photo") {
    const src = (post.urls && post.urls[0]) || post.url;
    const img = new Image();
    img.loading = "lazy";
    img.src = src;
    img.alt = post.title || "photo";
    thumb.appendChild(img);
    if (post.urls && post.urls.length > 1) {
      const badge = document.createElement("div");
      badge.className = "gallery-badge";
      thumb.appendChild(badge);
    }
  } else if (post.type === "video") {
    const id = isYouTube(post.url);
    if (id) {
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
  } else if (post.type === "link") {
    makeLinkCard(thumb, post.url, post.title);
  } else if (post.type === "text") {
    const wrap = document.createElement("div");
    wrap.className = "text-thumb";
    const h = document.createElement("h3");
    h.className = "text-thumb__title";
    const fallback = (post.text || "").trim().slice(0, 120);
    h.textContent = post.title || fallback || "Text";
    wrap.appendChild(h);
    thumb.appendChild(wrap);

    // Avoid repeating title below the thumb for text posts
    title.style.display = "none";
  }

  // Click → open modal
  node.addEventListener("click", () => openPost(post));
  return node;
}

// Build an enriched link preview card
async function makeLinkCard(container, url, fallbackTitle) {
  const wrap = document.createElement("div");
  wrap.className = "link-card";

  const img = new Image();
  img.className = "link-card__img";
  img.loading = "lazy";

  const text = document.createElement("div");
  text.className = "link-card__text";
  const h = document.createElement("h3");
  h.className = "link-card__title";
  const p = document.createElement("p");
  p.className = "link-card__desc";

  text.appendChild(h);
  text.appendChild(p);
  wrap.appendChild(img);
  wrap.appendChild(text);
  container.appendChild(wrap);

  // Show favicon instantly, then upgrade with OG image
  try {
    const u = new URL(url, window.location.href);
    img.src = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=128`;

    const q = `/api/preview?url=${encodeURIComponent(u.href)}`;
    const meta = await fetchJSON(q);

    h.textContent = meta.title || fallbackTitle || u.hostname;
    p.textContent = meta.description || u.hostname;

    if (meta.image) {
      img.src = meta.image;
    } else {
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

// ---------- filtering ----------

function matchesFilters(p) {
  const q = state.query.trim().toLowerCase();
  const inQuery = !q || [
    p.title,
    p.text,
    p.description,
    p.url,
    (p.tags || []).join(" ")
  ]
    .filter(Boolean)
    .some(s => s.toLowerCase().includes(q));

  const typeOk = state.type === "all" || p.type === state.type;
  const tagOk = !state.tag || (p.tags || []).includes(state.tag);

  // Date range (inclusive)
  let dateOk = true;
  if (state.dateFrom || state.dateTo) {
    const d = p.date ? new Date(p.date + "T00:00:00") : null;
    if (!d) {
      dateOk = false; // posts without date excluded when filtering
    } else {
      if (state.dateFrom) dateOk = dateOk && d >= parseDateISO(state.dateFrom);
      if (state.dateTo) dateOk = dateOk && d <= new Date(state.dateTo + "T23:59:59");
    }
  }

  const userOk = !state.user || p.user_id === state.user;

  return inQuery && typeOk && tagOk && dateOk && userOk;
}

// Render filtered posts
function render() {
  grid.innerHTML = "";
  state.posts.filter(matchesFilters).forEach(p => {
    grid.appendChild(renderCard(p));
  });

  updateTypeChips();
  $$("#tag-bar .chip").forEach(btn => {
    btn.classList.toggle("active", btn.textContent === `#${state.tag}`);
  });
}

async function refreshPosts() {
  const data = await fetchJSON("/api/posts");
  state.posts = data.posts;
  renderTagBar(collectTopTags(state.posts));
  render();
}

function renderAuthBar() {
  if (currentUser) {
    const avatar = currentUser.avatar || "/static/discord.svg";
    authBar.innerHTML = `
      <div class="user-menu">
        <button id="user-btn" class="user-btn"><img src="${avatar}" alt=""/><span>${currentUser.name}</span></button>
        <div id="user-menu-dropdown" class="dropdown hidden">
          <a href="/?user=${currentUser.id}">Profile</a>
          ${currentUser.is_admin ? '<a href="/admin">Admin</a>' : ''}
          <a href="/logout">Logout</a>
        </div>
      </div>`;
    newPostBtn.style.display = "inline-block";
    const btn = $("#user-btn");
    const menu = $("#user-menu-dropdown");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => menu.classList.add("hidden"));
  } else {
    authBar.innerHTML = `<a class="login-btn" href="/login"><img src="/static/discord.svg" alt="">Login with Discord</a>`;
    newPostBtn.style.display = "none";
  }
}

function openNewPost() {
  modal.classList.remove("hidden");
  modalContent.style.width = "600px";
  modalBody.innerHTML = $("#new-post-tpl").innerHTML;

  const pTitle = $("#p-title");
  const pText = $("#p-text");
  const pTags = $("#p-tags");
  const pTagsSuggest = $("#p-tags-suggest");
  const pImage = $("#p-image");
  const pPreviewWrap = $("#p-preview-wrap");
  const pPreviewRow = $("#p-preview-row");
  const createBtn = $("#create-post");

  const allTags = Array.from(new Set(state.posts.flatMap(p => p.tags || []))).sort((a, b) => a.localeCompare(b));

  function splitTags(val) {
    return val.split(',').map(t => t.trim()).filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }

  function renderSuggestions() {
    const existing = splitTags(pTags.value);
    const currentToken = pTags.value.split(',').slice(-1)[0].trim().toLowerCase();
    let sug = allTags.filter(t => !existing.includes(t) && (currentToken ? t.toLowerCase().startsWith(currentToken) : true));
    sug = sug.slice(0, 12);
    pTagsSuggest.innerHTML = "";
    if (sug.length === 0) {
      pTagsSuggest.classList.remove("visible");
      return;
    }
    sug.forEach(tag => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sugg-chip";
      btn.textContent = `#${tag}`;
      btn.addEventListener("mousedown", e => {
        e.preventDefault();
        const tokens = pTags.value.split(',').map(s => s.trim()).filter(Boolean);
        if (currentToken) {
          tokens[tokens.length - 1] = tag;
        } else {
          tokens.push(tag);
        }
        const final = tokens.filter((v, i, a) => a.indexOf(v) === i).join(", ");
        pTags.value = final + ", ";
        renderSuggestions();
        pTags.focus();
      });
      pTagsSuggest.appendChild(btn);
    });
    pTagsSuggest.classList.add("visible");
  }

  pTags.addEventListener("input", renderSuggestions);
  pTags.addEventListener("focus", renderSuggestions);
  pTags.addEventListener("blur", () => setTimeout(() => pTagsSuggest.classList.remove("visible"), 150));

  let attachedImages = [];

  function addFiles(files) {
    files.forEach(f => {
      if (!f.type.startsWith("image/")) return;
      const url = URL.createObjectURL(f);
      attachedImages.push({ file: f, url });
      const item = document.createElement("div");
      item.className = "preview-item";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "preview";
      item.appendChild(img);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "✖";
      btn.addEventListener("click", () => {
        const idx = attachedImages.findIndex(ai => ai.file === f);
        if (idx > -1) {
          URL.revokeObjectURL(attachedImages[idx].url);
          attachedImages.splice(idx, 1);
        }
        item.remove();
        if (attachedImages.length === 0) {
          pPreviewRow.style.display = "none";
        }
      });
      item.appendChild(btn);
      pPreviewWrap.appendChild(item);
    });
    if (attachedImages.length > 0) {
      pPreviewRow.style.display = "";
    }
  }

  pText.addEventListener("paste", e => {
    const imgs = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
    if (imgs.length) {
      addFiles(imgs);
      pImage.value = "";
      e.preventDefault();
    }
  });

  pImage.addEventListener("change", () => {
    const imgs = Array.from(pImage.files).filter(f => f.type.startsWith("image/"));
    if (imgs.length) {
      addFiles(imgs);
      pImage.value = "";
    }
  });

  async function handleCreatePost() {
    try {
      let r;
      if (attachedImages.length) {
        const fd = new FormData();
        fd.append("title", pTitle.value.trim());
        fd.append("text", pText.value.trim());
        fd.append("tags", splitTags(pTags.value).join(","));
        attachedImages.forEach(ai => fd.append("files", ai.file));
        r = await fetch("/api/post", { method: "POST", body: fd });
      } else {
        const body = {
          title: pTitle.value.trim(),
          text: pText.value.trim(),
          tags: splitTags(pTags.value).join(",")
        };
        r = await fetch("/api/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      }
      if (!r.ok) throw new Error(await r.text());
      await r.json();
      attachedImages.forEach(ai => URL.revokeObjectURL(ai.url));
      await refreshPosts();
      // reset form for another post
      pTitle.value = "";
      pText.value = "";
      pTags.value = "";
      pTagsSuggest.innerHTML = "";
      pTagsSuggest.classList.remove("visible");
      pPreviewWrap.innerHTML = "";
      attachedImages = [];
      pPreviewRow.style.display = "none";
    } catch (e) {
      alert("Failed: " + e.message);
    }
  }

  createBtn.addEventListener("click", e => {
    e.preventDefault();
    handleCreatePost();
  });
}

// Update the active state of type filter chips
function updateTypeChips() {
  typeChips.forEach(chip => {
    chip.classList.toggle("active", chip.dataset.type === state.type);
  });
}

// ---------- modal ----------

function openPost(post) {
  modal.classList.remove("hidden");
  modalContent.style.width = "";
  modalBody.innerHTML = "";

  if (post.type === "photo") {
    const urls = (post.urls && post.urls.length) ? post.urls : [post.url];
    urls.forEach(u => {
      const img = new Image();
      img.src = u;
      img.alt = post.title || "photo";
      img.className = "modal__media";
      modalBody.appendChild(img);
    });

    if (post.text) {
      const cap = document.createElement("div");
      cap.className = "modal__desc md";
      cap.innerHTML = renderMarkdown(post.text);
      modalBody.appendChild(cap);
    }
  } else if (post.type === "video") {
    const id = isYouTube(post.url);
    if (id) {
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
    if (post.title) {
      const h = document.createElement("h3");
      h.className = "modal__title";
      h.textContent = post.title;
      modalBody.appendChild(h);
    }
    const div = document.createElement("div");
    div.className = "modal__desc md";
    div.innerHTML = renderMarkdown(post.text || "");
    modalBody.appendChild(div);
  }

  // Meta (tags + date)
  const meta = document.createElement("div");
  meta.innerHTML = `
    <div class="tags">${(post.tags || []).map(t => `<span class="tag">#${t}</span>`).join(" ")}</div>
    <div class="muted">${fmtDate(post.date)}</div>
  `;
  modalBody.appendChild(meta);

  const commentsWrap = document.createElement("div");
  commentsWrap.className = "comments";

  let commentParent = null;
  const form = document.createElement("form");
  form.className = "comment-form";
  const ta = document.createElement("textarea");
  ta.required = true;
  const btn = document.createElement("button");
  btn.textContent = "Comment";
  form.append(ta, btn);

  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const payload = { text: ta.value };
      if (commentParent) payload.parent = commentParent;
      await fetch(`/api/post/${post.id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      ta.value = "";
      commentParent = null;
      btn.textContent = "Comment";
      commentsWrap.appendChild(form);
      await refreshPosts();
      const updated = state.posts.find(p => p.id === post.id);
      openPost(updated);
    } catch (err) {
      alert('Failed to comment: ' + err.message);
    }
  });

  function moveForm(target, parentId) {
    commentParent = parentId;
    btn.textContent = parentId ? "Reply" : "Comment";
    target.appendChild(form);
    ta.focus();
  }

  function renderComments(list) {
    const ul = document.createElement("ul");
    ul.className = "comments-list";
    list.forEach(c => {
      const li = document.createElement("li");
      li.className = "comment-item";

      const card = document.createElement("div");
      card.className = "comment-card";
      const avatar = document.createElement("img");
      avatar.className = "avatar";
      avatar.src = c.user && c.user.avatar ? c.user.avatar : "/static/discord.svg";
      avatar.alt = '';
      const body = document.createElement("div");
      body.className = "comment-body";
      const meta = document.createElement("div");
      meta.className = "comment-meta";
      meta.textContent = c.user ? c.user.name : 'Anon';
      const text = document.createElement("div");
      text.className = "comment-text md";
      text.innerHTML = renderMarkdown(c.text);
      body.append(meta, text);
      if (currentUser) {
        const replyBtn = document.createElement("button");
        replyBtn.type = 'button';
        replyBtn.className = 'reply-btn';
        replyBtn.textContent = 'Reply';
        replyBtn.addEventListener('click', () => moveForm(li, c.id));
        body.appendChild(replyBtn);
      }
      card.append(avatar, body);
      li.appendChild(card);
      if (c.replies && c.replies.length) {
        li.appendChild(renderComments(c.replies));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  if (post.comments && post.comments.length) {
    commentsWrap.appendChild(renderComments(post.comments));
  }

  if (currentUser) {
    commentsWrap.appendChild(form);
  }

  modalBody.appendChild(commentsWrap);
}

function closeModal() {
  // Pause YouTube players via postMessage
  const iframes = modalBody.querySelectorAll("iframe");
  iframes.forEach(f => {
    try {
      if (f.src.includes("youtube.com/embed/")) {
        f.contentWindow?.postMessage(
          JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
          "*"
        );
      }
    } catch (_) {}
  });
  modalBody.innerHTML = ""; // ensure playback stops
  modal.classList.add("hidden");
  modalContent.style.width = "";
}

// ---------- event binding ----------

function bindEvents() {
  searchInput.addEventListener("input", e => {
    state.query = e.target.value;
    render();
  });

  typeChips.forEach(chip => {
    chip.addEventListener("click", () => {
      state.type = chip.dataset.type;
      render();
    });
  });

  dateFromInput.addEventListener("change", () => {
    state.dateFrom = dateFromInput.value || null;
    render();
  });
  dateToInput.addEventListener("change", () => {
    state.dateTo = dateToInput.value || null;
    render();
  });
  dateClearBtn.addEventListener("click", () => {
    dateFromInput.value = "";
    dateToInput.value = "";
    state.dateFrom = state.dateTo = null;
    render();
  });

  $$('[data-close]').forEach(el => el.addEventListener("click", closeModal));
  modal.addEventListener("click", e => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });

  updateTypeChips();

  if (newPostBtn) {
    newPostBtn.addEventListener("click", openNewPost);
  }
}

// ---------- boot ----------

async function main() {
  try {
    const [site, data, me] = await Promise.all([
      fetchJSON("/api/site"),
      fetchJSON("/api/posts"),
      fetchJSON("/api/me"),
    ]);
    siteTitleEl.textContent = site.title || "";
    footerTitle.textContent = site.title || "";
    if (site.logo) {
      siteLogo.src = site.logo;
    } else {
      siteLogo.style.display = "none";
    }
    document.title = site.tab_text || site.title || document.title;
    const fav = $("#site-favicon");
    if (fav && site.favicon) fav.href = site.favicon;

    const params = new URLSearchParams(location.search);
    state.user = params.get("user");

    currentUser = me.user;
    renderAuthBar();

    state.posts = data.posts;
    renderTagBar(collectTopTags(state.posts));
    render();
  } catch (err) {
    grid.innerHTML = `<div class="muted">Failed to load posts: ${err.message}</div>`;
  }
}

bindEvents();
main();

