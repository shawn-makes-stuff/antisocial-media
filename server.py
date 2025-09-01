from flask import Flask, send_from_directory, jsonify, request, make_response
from werkzeug.utils import secure_filename
import os, json, re, requests, tempfile, time
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

app = Flask(__name__, static_url_path="/static", static_folder="static")
app.config["UPLOAD_FOLDER"] = os.path.join("static", "uploads")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20MB

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

POSTS_FILE = "posts/posts.json"
SITE_FILE  = "posts/site.json"  # profile meta
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "changeme")  # set real value in env!

YOUTUBE_PATTERNS = [
    r"(?:https?://)?(?:www\.)?youtube\.com/watch\?v=([A-Za-z0-9_\-]{6,})",
    r"(?:https?://)?(?:www\.)?youtu\.be/([A-Za-z0-9_\-]{6,})"
]

def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def atomic_write(path, data_obj):
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".json")
    with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
        json.dump(data_obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)

def load_posts():
    data = load_json(POSTS_FILE, {"posts": []})
    posts = data.get("posts", [])
    return sorted(posts, key=lambda p: p.get("date", ""), reverse=True)

def save_posts(posts):
    atomic_write(POSTS_FILE, {"posts": posts})

def load_site():
    return load_json(SITE_FILE, {
        "title": "Shawn",
        "description": "Senior Technical Product Specialist. Sharing photos, notes, videos, and interesting links.",
        "avatar": "/static/me.jpg"
    })

def save_site(site):
    atomic_write(SITE_FILE, site)

def require_admin(req):
    # very small “auth”: client sends X-Admin-Secret header
    secret = req.headers.get("X-Admin-Secret") or req.args.get("key")
    return secret == ADMIN_SECRET

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/admin")
def admin_page():
    # serve admin UI; no server-side session, front-end will send secret with each call
    return send_from_directory("static", "admin.html")

# -------- Public APIs --------

@app.route("/api/posts")
def api_posts():
    return jsonify({"posts": load_posts()})

@app.route("/api/site")
def api_site():
    return jsonify(load_site())

@app.route("/api/preview")
def api_preview():
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "Missing url"}), 400
    if not re.match(r"^https?://", url):
        url = "http://" + url
    try:
        r = requests.get(url, timeout=6, headers={"User-Agent":"Mozilla/5.0"})
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        def og(name):
            tag = soup.find("meta", property=f"og:{name}")
            return tag["content"].strip() if tag and tag.get("content") else None

        def sel_first(selectors):
            for s in selectors:
                tag = soup.select_one(s)
                if tag:
                    if tag.name == "meta":
                        v = tag.get("content")
                    else:
                        v = tag.get("href") or tag.get("content")
                    if v: return v.strip()
            return None

        title = og("title") or (soup.title.string.strip() if soup.title and soup.title.string else None)
        desc  = og("description") or sel_first([
            'meta[name="description"]',
            'meta[name="twitter:description"]'
        ])
        image = og("image") or sel_first([
            'meta[name="twitter:image"]',
            'link[rel="apple-touch-icon"]',
            'link[rel="icon"]',
            'link[rel="shortcut icon"]'
        ])

        # absolutize relative image URLs
        if image:
            image = urljoin(r.url, image)

        # if still nothing, use Google favicon service as a last resort
        if not image:
            host = urlparse(r.url).hostname or "example.com"
            image = f"https://www.google.com/s2/favicons?domain={host}&sz=128"

        return jsonify({"url": url, "title": title, "description": desc, "image": image})
    except Exception as e:
        return jsonify({"url": url, "title": None, "description": None, "image": None, "error": str(e)}), 200

# -------- Admin APIs --------

@app.route("/api/upload", methods=["POST"])
def api_upload():
    if not require_admin(request):
        return make_response(("Unauthorized", 401))
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
    filename = secure_filename(file.filename)
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(save_path)
    url = f"/static/uploads/{filename}"
    return jsonify({"url": url})

@app.route("/api/site", methods=["PUT"])
def api_update_site():
    if not require_admin(request):
        return make_response(("Unauthorized", 401))
    body = request.get_json(force=True, silent=True) or {}
    site = load_site()
    for k in ["title", "description", "avatar"]:
        if k in body:
            site[k] = body[k]
    save_site(site)
    return jsonify(site)

@app.route("/api/post", methods=["POST"])
def api_create_post():
    if not require_admin(request):
        return make_response(("Unauthorized", 401))
    p = request.get_json(force=True, silent=True) or {}
    # minimal validation
    if p.get("type") not in ("photo", "video", "text", "link"):
        return jsonify({"error":"Invalid type"}), 400
    p.setdefault("id", f"p-{int(time.time()*1000)}")
    p.setdefault("date", time.strftime("%Y-%m-%d"))
    p.setdefault("tags", [])
    posts = load_posts()
    posts.insert(0, p)
    save_posts(posts)
    return jsonify({"ok": True, "post": p})

@app.route("/api/post/<pid>", methods=["PUT"])
def api_update_post(pid):
    if not require_admin(request):
        return make_response(("Unauthorized", 401))
    body = request.get_json(force=True, silent=True) or {}
    posts = load_posts()
    for i, post in enumerate(posts):
        if post.get("id") == pid:
            post.update({k:v for k,v in body.items() if k in ("title","text","url","description","tags","type","date")})
            posts[i] = post
            save_posts(posts)
            return jsonify({"ok": True, "post": post})
    return jsonify({"error": "Not found"}), 404

@app.route("/api/post/<pid>", methods=["DELETE"])
def api_delete_post(pid):
    if not require_admin(request):
        return make_response(("Unauthorized", 401))
    posts = load_posts()
    new_posts = [p for p in posts if p.get("id") != pid]
    save_posts(new_posts)
    return jsonify({"ok": True, "deleted": pid})

# -------- Helpers --------

def is_youtube(url):
    for pat in YOUTUBE_PATTERNS:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None

@app.route("/api/detect", methods=["POST"])
def api_detect():
    data = request.get_json(force=True, silent=True) or {}
    url = data.get("url", "")
    yt = is_youtube(url)
    if yt:
        return jsonify({"type": "video", "platform": "youtube", "id": yt})
    if re.search(r"\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$", url, re.I):
        return jsonify({"type": "photo"})
    return jsonify({"type": "link"})

if __name__ == "__main__":
    # IMPORTANT: set ADMIN_SECRET in your shell before running
    #   Linux/macOS: export ADMIN_SECRET='your-strong-secret'
    #   Windows PS:  $env:ADMIN_SECRET='your-strong-secret'
    app.run(host="0.0.0.0", port=5173, debug=True)
