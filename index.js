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


//==================≠=======
//Delete post
//=======≠=================
app.delete("/posts/:postId", auth, async (req, res) => {

  try {

    const postId = req.params.postId;
    const userId = req.user.id;

    // =========================
    // 1. FIND POST
    // =========================

    const { data: post, error: findError } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (findError || !post) {

      return res.status(404).json({
        error: "Post not found"
      });

    }

    // =========================
    // 2. CHECK OWNER
    // =========================

    if (post.user_id !== userId) {

      return res.status(403).json({
        error: "Unauthorized"
      });

    }

    // =========================
    // 3. DELETE IMAGE FROM STORAGE
    // =========================

    if (post.file) {

      try {

        const fileName = post.file.split("/").pop();

        await supabase.storage
          .from("posts")
          .remove([fileName]);

      } catch (err) {

        console.log("Storage delete failed");

      }

    }

    // =========================
    // 4. DELETE POST
    // =========================

    const { error: deleteError } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId);

    if (deleteError) {

      return res.status(500).json({
        error: deleteError.message
      });

    }

    // CASCADE handles:
    // comments
    // replies
    // likes
    // dislikes
    // bookmarks

    res.json({
      success: true,
      message: "Post deleted"
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: "Server error"
    });

  }

});
//=============
//Edit post 
//========
app.get("/posts/:postId", async (req, res) => {

  try {

    const postId = req.params.postId;

    const { data, error } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json(data);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }

});

// ======================
// UPDATE POST
// ======================
app.put("/posts/:postId", auth, upload.single("file"), async (req, res) => {

  try {

    const postId = req.params.postId;
    const { title, content } = req.body;

    // check post
    const { data: existing } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: "Not allowed" });
    }

    let fileUrl = existing.file;

    // optional new file
    if (req.file) {

      const fileName = `${Date.now()}-${req.file.originalname}`;

      await supabase.storage
        .from("posts")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype
        });

      const { data } = supabase.storage
        .from("posts")
        .getPublicUrl(fileName);

      fileUrl = data.publicUrl;
    }

    const { data, error } = await supabase
      .from("posts")
      .update({
        title,
        content,
        file: fileUrl
      })
      .eq("id", postId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: "Updated", data });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }

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

app.get("/feed", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // ======================
    // LOAD DATA
    // ======================

    const { data: posts } = await supabase
      .from("posts")
      .select("*");

    const { data: likes } = await supabase
      .from("post_likes")
      .select("*");

    const { data: comments } = await supabase
      .from("comments")
      .select("*");

    const { data: bookmarks } = await supabase
      .from("bookmarks")
      .select("*");

    // ======================
    // INTERACTION MAP
    // ======================

    const interactedUsers = new Set();

    for (const like of likes || []) {
      if (like.user_id === userId) {
        const post = posts.find(
          p => p.id === like.post_id
        );

        if (post) {
          interactedUsers.add(post.user_id);
        }
      }
    }

    for (const comment of comments || []) {
      if (comment.user_id === userId) {
        const post = posts.find(
          p => p.id === comment.post_id
        );

        if (post) {
          interactedUsers.add(post.user_id);
        }
      }
    }

    // ======================
    // SCORE POSTS
    // ======================

    const scoredPosts = posts.map(post => {

      const likeCount =
        likes.filter(
          l => l.post_id === post.id
        ).length;

      const commentCount =
        comments.filter(
          c => c.post_id === post.id
        ).length;

      const bookmarkCount =
        bookmarks.filter(
          b => b.post_id === post.id
        ).length;

      // recent post
      const hoursOld =
        (Date.now() -
          new Date(post.created_at)) /
        (1000 * 60 * 60);

      const recentBonus =
        hoursOld <= 24 ? 10 : 0;

      // interacted creator
      const interactedBefore =
        interactedUsers.has(post.user_id);

      // creator age
      const creatorPosts =
        posts.filter(
          p => p.user_id === post.user_id
        );

      const oldestPost =
        creatorPosts.sort(
          (a, b) =>
            new Date(a.created_at) -
            new Date(b.created_at)
        )[0];

      const creatorAgeDays =
        (Date.now() -
          new Date(oldestPost.created_at)) /
        (1000 * 60 * 60 * 24);

      const isNewCreator =
        creatorAgeDays <= 30;

      let score = 0;

      score += recentBonus;
      score += likeCount * 5;
      score += commentCount * 10;
      score += bookmarkCount * 15;

      if (interactedBefore)
        score += 20;

      if (isNewCreator)
        score += 30;

      return {
        ...post,
        score,
        isNewCreator,
        interactedBefore
      };
    });

    // ======================
    // SORT
    // ======================

    scoredPosts.sort(
      (a, b) => b.score - a.score
    );

    // ======================
    // NEW CREATORS
    // ======================

    const newCreators =
      scoredPosts.filter(
        p => p.isNewCreator
      );

    // ======================
    // INTERACTED
    // ======================

    const interacted =
      scoredPosts.filter(
        p => p.interactedBefore
      );

    // ======================
    // RECOMMENDED
    // ======================

    const recommended =
      scoredPosts.filter(
        p =>
          !p.isNewCreator &&
          !p.interactedBefore
      );

    // ======================
    // BUILD FEED
    // ======================

    const feed = [
      ...newCreators.slice(0, 10),
      ...interacted.slice(0, 6),
      ...recommended.slice(0, 4)
    ];

    // ======================
    // REMOVE DUPLICATES
    // ======================

    const uniqueFeed =
      Array.from(
        new Map(
          feed.map(post => [
            post.id,
            post
          ])
        ).values()
      );

    // ======================
    // FINAL SORT
    // ======================

    uniqueFeed.sort(
      (a, b) => b.score - a.score
    );

    res.json(uniqueFeed);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Feed failed"
    });
  }
});

app.post("/posts/:id/promote", auth, async (req, res) => {
  try {
    const postId = req.params.id;

    // Find post
    const { data: post, error } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (error || !post) {
      return res.status(404).json({
        error: "Post not found"
      });
    }

    // Only owner can promote
    if (post.user_id !== req.user.id) {
      return res.status(403).json({
        error: "Not allowed"
      });
    }

    // Check existing promotion
    const { data: existing } = await supabase
      .from("promoted_posts")
      .select("*")
      .eq("post_id", postId)
      .maybeSingle();

    if (existing) {
      return res.json({
        message: "Already promoted"
      });
    }

    // Create promotion
    const { error: insertError } = await supabase
      .from("promoted_posts")
      .insert({
        post_id: postId,
        active: true
      });

    if (insertError) {
      throw insertError;
    }

    res.json({
      success: true,
      message: "Post promoted"
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Server error"
    });
  }
});
const PORT = process.env.PORT || 5000
app.listen(PORT,"0.0.0.0", () => console.log("Server running"));