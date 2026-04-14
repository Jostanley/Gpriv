require("dotenv").config()
const express = require("express");
const cors = require("cors");
const supabase = require("./supabase.js");
const xss = require("xss");
const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req,res)=>{
  console.log("back end working")
})
// =========================
// GET POSTS (ALL IN ONE)
// =========================

app.get("/posts", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("posts")
      .select(`
        *,
        comments (
          *,
          replies (*)
        )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// =========================
// CREATE POST
// =========================
app.post("/posts", async (req, res) => {
  try {
    let { title, content } = req.body;

    title = xss(title);
    content = xss(content);

    if (!title || !content) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const { data, error } = await supabase
      .from("posts")
      .insert([{ title, content,username:"Anonymous" }])
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch {
    res.status(500).json({ error: "Error creating post" });
  }
});

// =========================
// UPVOTE
// =========================
app.post("/posts/:id/upvote", async (req, res) => {
  const { data } = await supabase
    .from("posts")
    .select("upvotes")
    .eq("id", req.params.id)
    .single();

  await supabase
    .from("posts")
    .update({ upvotes: (data.upvotes || 0) + 1 })
    .eq("id", req.params.id);

  res.json({ success: true });
});

// =========================
// ADD COMMENT
// =========================
app.post("/posts/:id/comments", async (req, res) => {
  let { text } = req.body;
  text = xss(text);

  if (!text) return res.status(400).json({ error: "Empty" });

  await supabase.from("comments").insert([
    {
      post_id: req.params.id,
      text
    }
  ]);

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
app.post("/comments/:id/like", async (req, res) => {
  const { data } = await supabase
    .from("comments")
    .select("likes")
    .eq("id", req.params.id)
    .single();

  await supabase
    .from("comments")
    .update({ likes: (data.likes || 0) + 1 })
    .eq("id", req.params.id);

  res.json({ success: true });
});

app.post("/comments/:id/dislike", async (req, res) => {
  const { data } = await supabase
    .from("comments")
    .select("dislikes")
    .eq("id", req.params.id)
    .single();

  await supabase
    .from("comments")
    .update({ dislikes: (data.dislikes || 0) + 1 })
    .eq("id", req.params.id);

  res.json({ success: true });
});

// =========================
// REPLY
// =========================
app.post("/comments/:id/reply", async (req, res) => {
  let { text } = req.body;
  text = xss(text);

  await supabase.from("replies").insert([
    {
      comment_id: req.params.id,
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
  res.json(data);
});
const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log("Server running"));