const express = require("express");
const router = express.Router();
const path = require("path");

const User = require("../models/User");
const Prediction = require("../models/Prediction");
const LoginActivity = require("../models/LoginActivity");

function ensureAdmin(req, res) {
    if (!req.session.user || req.session.user.role !== "admin") {
        res.status(403).json({ success: false, message: "Access denied" });
        return false;
    }
    return true;
}

router.get("/admin", (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.redirect("/login");
    }

    res.sendFile(path.join(__dirname, "../views/admin.html"));
});

router.get("/admin/data", async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const [users, predictions, loginActivities] = await Promise.all([
            User.find().sort({ createdAt: -1 }).lean(),
            Prediction.find().sort({ createdAt: -1 }).lean(),
            LoginActivity.find().sort({ createdAt: -1 }).limit(120).lean()
        ]);

        const userMap = new Map(users.map((u) => [String(u._id), u]));

        const enrichedPredictions = predictions.map((p) => {
            const user = userMap.get(String(p.userId));
            return {
                ...p,
                userName: user?.name || "User",
                userEmail: user?.email || ""
            };
        });

        const enrichedActivities = loginActivities.map((a) => {
            const user = userMap.get(String(a.userId));
            return {
                ...a,
                userName: user?.name || a.name || "User",
                userEmail: user?.email || a.email || ""
            };
        });

        res.json({
            success: true,
            users,
            predictions: enrichedPredictions,
            loginActivities: enrichedActivities
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Unable to load admin data" });
    }
});

module.exports = router;
