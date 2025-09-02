from flask import (
    Flask,
    send_from_directory,
    jsonify,
    request,
    make_response,
    session,
    redirect,
    url_for,
)
from werkzeug.utils import secure_filename
import os, json, re, requests, tempfile, time
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

app = Flask(__name__, static_url_path="/static", static_folder="static")
app.config["UPLOAD_FOLDER"] = os.path.join("static", "uploads")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20MB
app.secret_key = os.environ.get("SECRET_KEY", "dev")

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

POSTS_FILE = "posts/posts.json"
SITE_FILE  = "posts/site.json"  # profile meta
USERS_FILE = "users/users.json"
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "changeme")  # set real value in env!

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "http://localhost:5173/callback")

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


def load_users():
    data = load_json(USERS_FILE, {"users": []})
    return data.get("users", [])


def save_users(users):
    atomic_write(USERS_FILE, {"users": users})


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    for u in load_users():
        if u.get("id") == uid:
            return u
    return None

def require_admin(req):
    user = current_user()
    if user and user.get("is_admin"):
        return True
    secret = req.headers.get("X-Admin-Secret") or req.args.get("key")
    return secret == ADMIN_SECRET

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/admin")
def admin_page():
    user = current_user()
    if not (user and user.get("is_admin")):
        return redirect("/login")
    return send_from_directory("static", "admin.html")


@app.route("/login")
def login():
    if not DISCORD_CLIENT_ID or not DISCORD_REDIRECT_URI:
        return make_response(("Discord OAuth not configured", 500))
    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify",
    }
    url = "https://discord.com/api/oauth2/authorize" + "?" + requests.compat.urlencode(params)
    return redirect(url)


@app.route("/callback")
def callback():
    code = request.args.get("code")
    if not code:
        return redirect("/")
    data = {
        "client_id": DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "scope": "identify",
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    r = requests.post("https://discord.com/api/oauth2/token", data=data, headers=headers)
    if r.status_code != 200:
        return make_response(("OAuth failed", 400))
    token = r.json().get("access_token")
    if not token:
        return make_response(("OAuth failed", 400))
    r = requests.get("https://discord.com/api/users/@me", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        return make_response(("OAuth user fetch failed", 400))
    info = r.json()
    users = load_users()
    uid = info.get("id")
    name = info.get("username")
    avatar_hash = info.get("avatar")
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{uid}/{avatar_hash}.png?size=64"
        if avatar_hash
        else None
    )
    user = next((u for u in users if u.get("id") == uid), None)
    if not user:
        user = {"id": uid, "name": name, "avatar": avatar_url, "is_admin": False}
        users.append(user)
    else:
        user["name"] = name
        user["avatar"] = avatar_url
    save_users(users)
    session["uid"] = uid
    return redirect("/")


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")

# -------- Public APIs --------

@app.route("/api/posts")
def api_posts():
    posts = load_posts()
    users = {u["id"]: u for u in load_users()}

    def attach_user(comments):
        for c in comments:
            uid = c.get("user_id")
            if uid and uid in users:
                cu = users[uid]
                c["user"] = {
                    "id": uid,
                    "name": cu.get("name"),
                    "avatar": cu.get("avatar"),
                }
            attach_user(c.get("replies", []))

    def count_comments(comments):
        return sum(1 + count_comments(c.get("replies", [])) for c in comments)

    for p in posts:
        uid = p.get("user_id")
        if uid and uid in users:
            uu = users[uid]
            p["user"] = {"id": uid, "name": uu.get("name"), "avatar": uu.get("avatar")}
        comments = p.get("comments", [])
        p["comment_count"] = count_comments(comments)
        attach_user(comments)

    return jsonify({"posts": posts})


@app.route("/api/me")
def api_me():
    return jsonify({"user": current_user()})


@app.route("/api/users")
def api_users():
    if not require_admin(request):
        return make_response(("Unauthorized", 401))
    return jsonify({"users": load_users()})


@app.route("/api/users/<uid>", methods=["PUT"])
def api_user_update(uid):
    if not require_admin(request):
        return make_response(("Unauthorized", 401))
    body = request.get_json(force=True, silent=True) or {}
    users = load_users()
    for i, u in enumerate(users):
        if u.get("id") == uid:
            u["is_admin"] = bool(body.get("is_admin"))
            users[i] = u
            save_users(users)
            return jsonify({"ok": True, "user": u})
    return jsonify({"error": "Not found"}), 404

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
    orig = secure_filename(file.filename or "")
    ext = os.path.splitext(orig)[1] or ""
    filename = f"upload-{int(time.time()*1000)}{ext}"
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
    user = current_user()
    if not user:
        return make_response(("Unauthorized", 401))

    # Accept multipart form so image files can be sent directly with the post.
    # Fall back to parsing JSON when no files are uploaded.
    if request.files:
        form = request.form
        files = request.files.getlist("files") or request.files.getlist("file")
        if not files:
            f = request.files.get("file")
            files = [f] if f else []
    elif request.form:
        # Form submission without files (e.g. standard form POST)
        form = request.form
        files = []
    else:
        form = request.get_json(force=True, silent=True) or {}
        files = []
    title = (form.get("title") or "").strip()
    text  = (form.get("text") or "").strip()
    tags_raw = form.get("tags") or ""
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()]

    url = None
    urls = []
    ptype = "text"

    if files:
        for i, file in enumerate(files):
            orig = secure_filename(file.filename or "")
            ext = os.path.splitext(orig)[1] or ""
            filename = f"upload-{int(time.time()*1000)}-{i}{ext}"
            save_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
            file.save(save_path)
            urls.append(f"/static/uploads/{filename}")
        url = urls[0]
        ptype = "photo"
    else:
        # Look for a URL in the text
        m = re.search(r"https?://\S+", text)
        if m:
            url = m.group(0)
            text = text.replace(url, "").strip()
            if is_youtube(url):
                ptype = "video"
            else:
                ptype = "link"

    post = {
        "id": f"p-{int(time.time()*1000)}",
        "date": time.strftime("%Y-%m-%d"),
        "tags": tags,
        "title": title or None,
        "text": text or None,
        "url": url,
        "type": ptype,
        "user_id": user["id"],
        "comments": [],
    }
    if urls:
        post["urls"] = urls

    posts = load_posts()
    posts.insert(0, post)
    save_posts(posts)
    return jsonify({"ok": True, "post": post})

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


@app.route("/api/post/<pid>/comment", methods=["POST"])
def api_post_comment(pid):
    user = current_user()
    if not user:
        return make_response(("Unauthorized", 401))
    body = request.get_json(force=True, silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return make_response(("Missing text", 400))
    parent_id = body.get("parent") or body.get("parent_id")
    posts = load_posts()
    for i, post in enumerate(posts):
        if post.get("id") == pid:
            def find_comment(comments, cid):
                for c in comments:
                    if c.get("id") == cid:
                        return c
                    found = find_comment(c.get("replies", []), cid)
                    if found:
                        return found
                return None

            comment = {
                "id": f"c-{int(time.time()*1000)}",
                "user_id": user["id"],
                "text": text,
                "date": time.strftime("%Y-%m-%d"),
                "replies": [],
            }
            if parent_id:
                parent = find_comment(post.setdefault("comments", []), parent_id)
                if not parent:
                    return jsonify({"error": "parent not found"}), 404
                parent.setdefault("replies", []).append(comment)
            else:
                post.setdefault("comments", []).append(comment)
            posts[i] = post
            save_posts(posts)
            return jsonify({"ok": True, "comment": comment})
    return jsonify({"error": "Not found"}), 404

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
