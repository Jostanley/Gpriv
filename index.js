require("dotenv").config()
const express = require("express");
const cors = require("cors");
const supabase = require("./supabase.js");
const multer = require("multer");
const xss = require("xss");
const app = express();

app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token" });

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid user" });
  }

  req.user = data.user;
  next();
};

app.get('/', (req, res)=>{
  console.log("back end working")
  res.status(200).send("back end working")
})


/**
 * ======================
 * CREATE POST (UPLOAD + SAVE)
 * ======================
 */
app.post("/posts", auth, upload.single("file"), async (req, res) => {
  try {
    let { title, content } = req.body;

    title = xss(title);
    content = xss(content);

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content required" });
    }

    let fileUrl = null;

    // ======================
    // 1. UPLOAD FILE (IF EXISTS)
    // ======================
    if (req.file) {
      const file = req.file;
      const fileName = `${Date.now()}-${file.originalname}`;

      const { error: uploadError } = await supabase.storage
        .from("posts")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("posts")
        .getPublicUrl(fileName);

      fileUrl = data.publicUrl;
    }

    // ======================
    // 2. SAVE POST TO DATABASE
    // ======================
    const { data, error } = await supabase
      .from("posts")
      .insert([
        {
          title,
          content,
          file: fileUrl,
          user_id: req.user.id,
          username: "Anonymous"
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

/**
 * ======================
 * GET POSTS
 * ======================
 */
app.get("/posts", async (req, res) => {
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});


// =========================
// UPVOTE
// =========================
app.post("/posts/:id/upvote", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    // Check if this user already liked THIS post
    const { data: existing, error } = await supabase
      .from("post_likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      // Unlike (delete only this user's like for this post)
      await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId);

      console.log("unliked");
      return res.json({ success: true, liked: false });
    } else {
      // Like
      await supabase
        .from("post_likes")
        .insert({
          user_id: userId,
          post_id: postId,
        });

      console.log("liked");
      return res.json({ success: true, liked: true });
    }

  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
});
// =========================
// ADD COMMENT
// =========================
app.post("/posts/:id/comments", auth, async (req, res) => {
  let { text } = req.body;
  text = xss(text);
 console.log(text)
  if (!text) return res.status(400).json({ error: "Empty" });

  const newComments = await supabase.from("comments").insert([
    {
      user_id: req.user.id,
      email: req.user.email,
      post_id: req.params.id,
      text
      
    }
  ]);
 console.log(newComments)
  res.json({ success: true });
});

app.get("/posts/:id/comments", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("comments")
      .select(`
        *,
        replies (*)
      `)
      .eq("post_id", req.params.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load comments" });
  }
});
// =========================
// LIKE / DISLIKE
// =========================

//get post likes
app.get("/postsLikes", async (req, res) => {
  const { data, error } = await supabase
    .from("post_likes")
    .select("*");

  if (error) {
    return res.status(400).json(error);
  }

  res.json(data); // ✅ FIXED
});
//reply dislikes
app.post("/comments/:id/like", auth, async (req, res) => {
  const comment_id = req.params.id;
  const user_id = req.user.id;
  console.log(user_id)
  // check if user already liked
  const { data: existing } = await supabase
    .from("comments")
    .select("*")
    .eq("comment_id", comment_id)
    .eq("user_id", user_id)
    .single();
 console.log(existing)
  if (existing) {
    // UNLIKE (remove like)
    await supabase
      .from("comments")
      .delete()
      .eq("comment_id", comment_id)
      .eq("user_id", user_id);
 console.log("you already liked")
    return res.json({ liked: false });
  }

  // LIKE
  await supabase.from("comments").insert([
    {
      comment_id,
      user_id
    }
  ]);
 console.log("liked")
  res.json({ liked: true });
});

app.post("/replies/:id/like", auth,
async (req, res) => {
  try {
    const replyId = req.params.id;
    const userId = req.user.id;

    // check if already liked
    const { data: existing } = await supabase
      .from("reply_likes")
      .select("*")
      .eq("comment_id", replyId)
      .eq("user_id", userId)
      .maybeSingle(); // ✅ better than single()

    if (existing) {
      // remove dislike
      await supabase
        .from("reply_likes")
        .delete()
        .eq("comment_id", replyId)
        .eq("user_id", userId);
       console.log("disliked" ,replyId)
      return res.json({ message: "like removed" });
    } else {
      // add dislike
      const {data, error } = await supabase
        .from("reply_likes")
        .insert({
          comment_id: replyId,
          user_id: userId,
        });
     console.log("liked" ,replyId)
     console.log(error)
      return res.json({ message: "Reply liked" });
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/replylikes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("reply_likes")
      .select("*");

    if (error) {
      console.log(error)
      return res.status(400).json({ error: error.message });
    }
    
    res.json(data);
    console.log(data)
  } catch (err) {
    console.log(err)
    res.status(500).json({ error: "Server error" });
  }
});


app.post("/replies/:id/dislike", auth, async (req, res) => {
  try {
    const replyId = req.params.id;
    const userId = req.user.id;

    // check if already disliked
    const { data: existing } = await supabase
      .from("reply_dislikes")
      .select("*")
      .eq("comment_id", replyId)
      .eq("user_id", userId)
      .maybeSingle(); // ✅ better than single()

    if (existing) {
      // remove dislike
      await supabase
        .from("reply_dislikes")
        .delete()
        .eq("comment_id", replyId)
        .eq("user_id", userId);
       console.log("liked")
      return res.json({ message: "Dislike removed" });
    } else {
      // add dislike
      const {data, error } = await supabase
        .from("reply_dislikes")
        .insert({
          comment_id: replyId,
          user_id: userId,
        });
     console.log("disliked")
     console.log(error)
      return res.json({ message: "Reply disliked" });
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/replydislikes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("reply_dislikes")
      .select("*");

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
// =========================
// REPLY
// =========================
app.post("/comments/:id/reply",auth, async (req, res) => {
  let { text } = req.body;
  text = xss(text);
console.log(text)
  await supabase.from("replies").insert([
    {
      comment_id: req.params.id,
      user_id: req.user.id,
      text
    }
  ]);

  res.json({ success: true });
});

// =========================

//get comments
// =======================
// GET ALL COMMENTS
app.get("/comments", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("comments")
      .select("*");

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/replies", async (req, res) => {
  const { data } = await supabase.from("replies").select("*");
 res.status(200).json(data);
  
});
app.post("/bookmark", auth, async (req, res) => {
  const userId = req.user.id;
  const { post_id } = req.body;

  const { data: existing } = await supabase
    .from("bookmarks")
    .select("*")
    .eq("user_id", userId)
    .eq("post_id", post_id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("bookmarks")
      .delete()
      .eq("id", existing.id);

    return res.json({ message: "removed" });
  }

  await supabase.from("bookmarks").insert({
    user_id: userId,
    post_id
  });

  res.json({ message: "saved" });
});
app.get("/bookmarks/full", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // =====================
    // 1. BOOKMARKS (SAFE)
    // =====================
    const { data: bookmarks, error: bErr } = await supabase
      .from("bookmarks")
      .select("post_id")
      .eq("user_id", userId);

    if (bErr) throw bErr;

    const postIds = (bookmarks || []).map(b => b.post_id);

    if (postIds.length === 0) return res.json([]);

    // =====================
    // 2. POSTS
    // =====================
    const { data: posts, error: pErr } = await supabase
      .from("posts")
      .select("*")
      .in("id", postIds);

    if (pErr) throw pErr;

    // =====================
    // 3. COMMENTS
    // =====================
    const { data: comments, error: cErr } = await supabase
      .from("comments")
      .select("*")
      .in("post_id", postIds);

    if (cErr) throw cErr;

    // =====================
    // 4. REPLIES
    // =====================
    const commentIds = (comments || []).map(c => c.id);

    const { data: replies, error: rErr } = await supabase
      .from("replies")
      .select("*")
      .in("comment_id", commentIds);

    if (rErr) throw rErr;

    // =====================
    // 5. LIKES
    // =====================
    const { data: postLikes } = await supabase
      .from("posts_likes")
      .select("*")
      .in("post_id", postIds);

    const { data: replyLikes } = await supabase
      .from("reply_likes")
      .select("*");

    const { data: replyDislikes } = await supabase
      .from("reply_dislikes")
      .select("*");

    // =====================
    // SAFE FALLBACKS
    // =====================
    const safePosts = posts || [];
    const safeComments = comments || [];
    const safeReplies = replies || [];
    const safePostLikes = postLikes || [];
    const safeReplyLikes = replyLikes || [];
    const safeReplyDislikes = replyDislikes || [];

    // =====================
    // COMBINE DATA
    // =====================
    safePosts.forEach(post => {
      post.likes = safePostLikes.filter(l => l.post_id === post.id).length;

      post.comments = safeComments
        .filter(c => c.post_id === post.id)
        .map(c => {
          const cReplies = safeReplies.filter(r => r.comment_id === c.id);

          return {
            ...c,
            liked: safeReplyLikes.filter(l => l.comment_id === c.id).length,
            disliked: safeReplyDislikes.filter(d => d.comment_id === c.id).length,
            replies: cReplies
          };
        });
    });

    res.json(safePosts);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/bookmarks/:postId", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.params;

    // 1. Delete only THIS user's bookmark for this post
    const { data, error } = await supabase
      .from("bookmarks")
      .delete()
      .eq("user_id", userId)
      .eq("post_id", postId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({
      success: true,
      message: "Bookmark deleted successfully"
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});
const PORT = process.env.PORT || 5000
app.listen(PORT,"0.0.0.0", () => console.log("Server running"));