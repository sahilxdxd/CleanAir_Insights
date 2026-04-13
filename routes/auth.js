const express = require("express");
const router = express.Router();
const path = require("path");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const LoginActivity = require("../models/LoginActivity");

router.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../views/index.html"));
});

router.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "../views/login.html"));
});

router.get("/signup", (req, res) => {
    res.sendFile(path.join(__dirname, "../views/signup.html"));
});

router.get("/dashboard", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    res.sendFile(path.join(__dirname, "../views/dashboard.html"));
});

router.get("/logout", async (req, res) => {
    const user = req.session.user;
    if (user) {
        try {
            await LoginActivity.create({
                userId: String(user._id),
                name: user.name || "",
                email: user.email || "",
                action: "logout",
                ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                userAgent: req.headers["user-agent"] || ""
            });
        } catch (err) {
            console.log("logout activity error:", err.message);
        }
    }

    req.session.destroy(() => {
        res.redirect("/login");
    });
});

router.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existing = await User.findOne({ email });
        if (existing) {
            return res.json({ success: false, message: "User already exists" });
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = new User({
            name: String(name || "").trim(),
            email: String(email || "").trim().toLowerCase(),
            password: hashed
        });

        await user.save();

        res.json({
            success: true,
            redirect: "/login"
        });
    } catch (err) {
        console.log(err);
        res.json({ success: false, message: "Signup failed" });
    }
});

router.post("/login", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        const user = await User.findOne({ email });
        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.json({ success: false, message: "Wrong password" });
        }

        user.lastLoginAt = new Date();
        user.loginCount = (user.loginCount || 0) + 1;
        await user.save();

        req.session.user = user.toObject();

        try {
            await LoginActivity.create({
                userId: String(user._id),
                name: user.name || "",
                email: user.email || "",
                action: "login",
                ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                userAgent: req.headers["user-agent"] || ""
            });
        } catch (err) {
            console.log("login activity error:", err.message);
        }

        res.json({
            success: true,
            redirect: "/dashboard"
        });
    } catch (err) {
        console.log(err);
        res.json({ success: false, message: "Login failed" });
    }
});

module.exports = router;
